import { commands, window, Uri, workspace } from "vscode";
import { Resource } from "./scm/Resource";
import { Status } from "./scm/Status";
import { FileType } from "./scm/FileTypes";
import { Display } from "./Display";
import * as Path from "path";
import * as fs from "fs";
import * as PerforceUri from "./PerforceUri";
import * as p4 from "./api/PerforceApi";

export enum DiffType {
    WORKSPACE_V_DEPOT,
    SHELVE_V_DEPOT,
    WORKSPACE_V_SHELVE,
}

function numberOfLeadingSlashes(str: string, after = 0) {
    return str
        .slice(after)
        .split("")
        .findIndex((a) => a !== "/" && a !== "\\");
}

function findLengthOfCommonPrefix(sa: string, sb: string) {
    const aDir = Path.dirname(sa);
    const bDir = Path.dirname(sb);
    if (aDir === bDir) {
        const remainingCommonSlashes = Math.max(
            0,
            Math.min(
                numberOfLeadingSlashes(sa, aDir.length),
                numberOfLeadingSlashes(sb, bDir.length)
            )
        );
        return aDir.length + remainingCommonSlashes;
    }
    const i = sa.split("").findIndex((a, i) => a !== sb[i]);
    return i;
}

function getUnprefixedName(file: string, prefixLength: number) {
    return prefixLength <= 0 ? Path.basename(file) : file.slice(prefixLength);
}

export function getPathsWithoutCommonPrefix(a: string, b: string): [string, string] {
    const prefixLen = findLengthOfCommonPrefix(a, b);
    return [getUnprefixedName(a, prefixLen), getUnprefixedName(b, prefixLen)];
}

function pathWithRev(path: string, revOrAtLabel: string, couldBeWorkspace?: boolean) {
    if (!revOrAtLabel) {
        return couldBeWorkspace ? path + " (workspace)" : path;
    }
    if (isNaN(parseInt(revOrAtLabel))) {
        return path + revOrAtLabel;
    }
    return path + "#" + revOrAtLabel;
}

export function diffTitleForDepotPaths(
    leftPath: string,
    leftRevision: string,
    rightPath: string,
    rightRevision: string
) {
    const [leftTitle, rightTitle] = getPathsWithoutCommonPrefix(leftPath, rightPath);
    return (
        pathWithRev(leftTitle, leftRevision) +
        " ⟷ " +
        pathWithRev(rightTitle, rightRevision)
    );
}

function diffTitleForFiles(leftFile: Uri, rightFile: Uri) {
    if (!PerforceUri.isDepotUri(rightFile)) {
        const rightRev = PerforceUri.getRevOrAtLabel(rightFile);
        return (
            pathWithRev(
                PerforceUri.basenameWithoutRev(leftFile),
                PerforceUri.getRevOrAtLabel(leftFile)
            ) +
            " ⟷ " +
            pathWithRev(PerforceUri.basenameWithoutRev(rightFile), rightRev, true)
        );
    }
    const leftPath = PerforceUri.getDepotPathFromDepotUri(leftFile);
    const rightPath = PerforceUri.getDepotPathFromDepotUri(rightFile);

    return diffTitleForDepotPaths(
        leftPath,
        PerforceUri.getRevOrAtLabel(leftFile),
        rightPath,
        PerforceUri.getRevOrAtLabel(rightFile)
    );
}

export async function diffFiles(leftFile: Uri, rightFile: Uri, title?: string) {
    // ensure we don't keep stacking left files
    const leftFileWithoutLeftFiles = PerforceUri.withArgs(leftFile, {
        leftUri: undefined,
    });
    const gotStartFile =
        PerforceUri.decodeUriQuery(rightFile.query).diffStartFile ??
        PerforceUri.decodeUriQuery(leftFile.query).diffStartFile;

    // DON'T ADD QUERY PARAMS to a file: URI
    const rightUriWithLeftInfo =
        rightFile.scheme === "perforce"
            ? PerforceUri.withArgs(rightFile, {
                  leftUri: leftFileWithoutLeftFiles.toString(),
                  diffStartFile: gotStartFile ?? rightFile.toString(),
              })
            : rightFile;

    const fullTitle = title ?? diffTitleForFiles(leftFile, rightFile);

    await commands.executeCommand<void>(
        "vscode.diff",
        leftFileWithoutLeftFiles,
        rightUriWithLeftInfo,
        fullTitle
    );
}

function getPreviousUri(fromUri: Uri) {
    const rightRev = parseInt(PerforceUri.getRevOrAtLabel(fromUri));
    if (isNaN(rightRev)) {
        return undefined;
    }
    if (rightRev <= 1) {
        return undefined;
    }
    return PerforceUri.fromUriWithRevision(fromUri, (rightRev - 1).toString());
}

/**
 * Diffs a URI with a revision number against a URI with the previous revision number (provided it is > 0)
 * @param rightUri
 */
async function diffPreviousFrom(rightUri?: Uri) {
    if (!rightUri) {
        Display.showImportantError("No previous revision available");
        return;
    }
    const leftUri = getPreviousUri(rightUri);
    if (!leftUri) {
        Display.showImportantError("No previous revision available");
        return;
    }
    await diffFiles(leftUri, rightUri);
}

/**
 * Work out the have revision for the file, and diff the working file against that revision
 */
async function diffPreviousFromWorking(fromDoc: Uri, fromDiffEditor?: boolean) {
    const leftUri = (await p4.have(fromDoc, { file: fromDoc }))?.depotUri;
    if (!leftUri) {
        Display.showImportantError("No previous revision available");
        return;
    }
    const leftWithRev = PerforceUri.withArgs(leftUri, {
        haveRev: PerforceUri.getRevOrAtLabel(leftUri),
        diffStartFile: fromDoc.toString(),
    });
    if (fromDiffEditor) {
        // already in a diff where right hand is a local file - skip a revision
        await diffPreviousFrom(leftWithRev);
    } else {
        await diffFiles(leftWithRev, fromDoc);
    }
    // can't put query params on to the fromDoc as a file: uri - it breaks some things in vs code, remote ssh and cpp extension
}

/**
 * Use the information provided in the right hand URI, about the left hand file, to perform the diff, if possible
 * @param fromDoc the current right hand URI
 * @returns a promise if the diff is possible, or false otherwise
 */
function diffPreviousUsingLeftInfo(fromDoc: Uri): boolean | Promise<void> {
    const args = PerforceUri.decodeUriQuery(fromDoc.query);
    const workspace = PerforceUri.getUsableWorkspace(fromDoc);
    if (!workspace) {
        throw new Error("No usable workspace found for " + fromDoc);
    }
    if (!args.leftUri) {
        return false;
    }
    const rightUri = PerforceUri.withArgs(PerforceUri.parse(args.leftUri), {
        diffStartFile: args.diffStartFile,
    });
    return diffPreviousFrom(rightUri);
}

async function diffPreviousUsingRevision(fromDoc: Uri, fromDiffEditor?: boolean) {
    const rev = parseInt(PerforceUri.getRevOrAtLabel(fromDoc));
    if (isNaN(rev)) {
        await diffPreviousFromWorking(fromDoc, fromDiffEditor);
    } else {
        await diffPreviousFrom(fromDoc);
    }
}

/**
 * Diffs against the fromDoc's previous revision, regardless of whether
 * the supplied URI is the right hand of a diff
 * @param fromDoc the Uri to diff
 */
export async function diffPreviousIgnoringLeftInfo(fromDoc: Uri) {
    await diffPreviousUsingRevision(fromDoc);
}

export async function diffPrevious(fromDoc: Uri, fromDiffEditor?: boolean) {
    const usingLeftInfo = diffPreviousUsingLeftInfo(fromDoc);
    if (usingLeftInfo) {
        await usingLeftInfo;
    } else {
        await diffPreviousUsingRevision(fromDoc, fromDiffEditor);
    }
}

export async function diffNext(fromDoc: Uri) {
    const rev = parseInt(PerforceUri.getRevOrAtLabel(fromDoc));
    if (isNaN(rev)) {
        Display.showImportantError("No more revisions available");
        return;
    }

    const leftUri = fromDoc;

    const args = PerforceUri.decodeUriQuery(fromDoc.query);
    const atHaveRev = args.haveRev && parseInt(args.haveRev) === rev;
    const rightUri =
        atHaveRev && args.diffStartFile
            ? PerforceUri.parse(args.diffStartFile)
            : PerforceUri.fromUriWithRevision(fromDoc, (rev + 1).toString());

    await diffFiles(leftUri, rightUri);
}

export async function diffDefault(
    resource: Resource,
    diffType?: DiffType
): Promise<void> {
    if (resource.FileType.base === FileType.BINARY) {
        const uri = PerforceUri.fromUri(resource.openUri, { command: "fstat" });
        await workspace.openTextDocument(uri).then((doc) => window.showTextDocument(doc));
        return;
    }

    if (diffType === undefined) {
        diffType = resource.isShelved
            ? DiffType.SHELVE_V_DEPOT
            : DiffType.WORKSPACE_V_DEPOT;
    }

    const left = getLeftResource(resource, diffType);
    const right = getRightResource(resource, diffType);

    if (!left) {
        if (!right) {
            // TODO
            console.error("Status not supported: " + resource.status.toString());
            return;
        }
        await window.showTextDocument(right);
        return;
    }
    if (!right) {
        await window.showTextDocument(left.uri);
        return;
    }

    const leftUri = PerforceUri.withArgs(left.uri, {
        haveRev: resource.workingRevision,
    });
    // don't add query params to file: URIs
    const rightUri =
        right.scheme === "file"
            ? right
            : PerforceUri.withArgs(right, {
                  haveRev: resource.workingRevision,
              });
    await diffFiles(leftUri, rightUri, getTitle(resource, left.title, diffType));
    return;
}

// Gets the uri for the previous version of the file.
function getLeftResource(
    resource: Resource,
    diffType: DiffType
): { title: string; uri: Uri } | undefined {
    if (diffType === DiffType.WORKSPACE_V_SHELVE) {
        // left hand side is the shelve
        switch (resource.status) {
            case Status.ADD:
            case Status.EDIT:
            case Status.INTEGRATE:
            case Status.MOVE_ADD:
            case Status.BRANCH:
                const leftUri = PerforceUri.fromUriWithRevision(
                    resource.openUri,
                    "@=" + resource.change // still need to specify because the resource could be either the open or workspace file
                );
                return {
                    title: Path.basename(leftUri.fsPath),
                    uri: leftUri,
                };
            case Status.DELETE:
            case Status.MOVE_DELETE:
        }
    } else {
        const emptyDoc = Uri.parse("perforce:EMPTY");
        // left hand side is the depot version
        switch (resource.status) {
            case Status.ADD:
            case Status.BRANCH:
                return {
                    title: PerforceUri.basenameWithoutRev(resource.openUri) + "#0",
                    uri: emptyDoc,
                };
            case Status.MOVE_ADD:
                // diff against the old file if it is known (always a depot path)
                return {
                    title: resource.fromFile
                        ? Path.basename(resource.fromFile.fsPath)
                        : "Depot Version",
                    uri: resource.fromFile ?? emptyDoc,
                };
            case Status.INTEGRATE:
            case Status.EDIT:
            case Status.DELETE:
            case Status.MOVE_DELETE:
                const leftUri = PerforceUri.fromUriWithRevision(
                    resource.openUri,
                    resource.workingRevision
                );
                return {
                    title: Path.basename(leftUri.fsPath),
                    uri: leftUri,
                };
        }
    }
}

// Gets the uri for the current version of the file (or the shelved version depending on the diff type).
function getRightResource(resource: Resource, diffType: DiffType): Uri | undefined {
    const emptyDoc = Uri.parse("perforce:EMPTY");
    if (diffType === DiffType.SHELVE_V_DEPOT) {
        switch (resource.status) {
            case Status.ADD:
            case Status.EDIT:
            case Status.MOVE_ADD:
            case Status.INTEGRATE:
            case Status.BRANCH:
                return resource.openUri;
        }
    } else {
        const exists =
            !resource.isShelved ||
            (resource.underlyingUri && fs.existsSync(resource.underlyingUri.fsPath));
        switch (resource.status) {
            case Status.ADD:
            case Status.EDIT:
            case Status.MOVE_ADD:
            case Status.INTEGRATE:
            case Status.BRANCH:
                return exists ? resource.underlyingUri ?? emptyDoc : emptyDoc;
        }
    }
}

function getTitle(resource: Resource, leftTitle: string, diffType: DiffType): string {
    const basename = PerforceUri.basenameWithoutRev(resource.openUri);
    const basenameWithRev = Path.basename(resource.openUri.fsPath);

    let text = "";
    switch (diffType) {
        case DiffType.SHELVE_V_DEPOT:
            text = leftTitle + " ⟷ " + basenameWithRev;
            break;
        case DiffType.WORKSPACE_V_SHELVE:
            text = leftTitle + " ⟷ " + basename + " (workspace)";
            break;
        case DiffType.WORKSPACE_V_DEPOT:
            text = leftTitle + " ⟷ " + basename + " (workspace)";
    }
    return text;
}
