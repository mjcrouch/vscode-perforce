import { commands, window, Uri, workspace } from "vscode";
import { Resource } from "./scm/Resource";
import { Status } from "./scm/Status";
import { FileType } from "./scm/FileTypes";
import * as Path from "path";
import * as fs from "fs";
import * as PerforceUri from "./PerforceUri";

export enum DiffType {
    WORKSPACE_V_DEPOT,
    SHELVE_V_DEPOT,
    WORKSPACE_V_SHELVE
}

function findLengthOfCommonPrefix(sa: string, sb: string) {
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

export function diffTitleForDepotPaths(
    leftPath: string,
    leftRevision: string,
    rightPath: string,
    rightRevision: string
) {
    const [leftTitle, rightTitle] = getPathsWithoutCommonPrefix(leftPath, rightPath);
    return leftTitle + "#" + leftRevision + " ⟷ " + rightTitle + "#" + rightRevision;
}

function diffTitleForFiles(leftFile: Uri, rightFile: Uri) {
    if (!PerforceUri.isDepotUri(rightFile)) {
        return (
            Path.basename(leftFile.fsPath) +
            "#" +
            leftFile.fragment +
            " ⟷ " +
            Path.basename(rightFile.fsPath) +
            (rightFile.fragment ? "#" + rightFile.fragment : " (workspace)")
        );
    }
    const leftPath = PerforceUri.getDepotPathFromDepotUri(leftFile);
    const rightPath = PerforceUri.getDepotPathFromDepotUri(rightFile);

    return diffTitleForDepotPaths(
        leftPath,
        leftFile.fragment,
        rightPath,
        rightFile.fragment
    );
}

export async function diffFiles(leftFile: Uri, rightFile: Uri, title?: string) {
    // ensure we don't keep stacking left files
    const leftFileWithoutLeftFiles = PerforceUri.withArgs(leftFile, {
        leftUri: undefined
    });
    const rightUriWithLeftInfo = PerforceUri.withArgs(rightFile, {
        leftUri: leftFileWithoutLeftFiles.toString()
    });

    const fullTitle = title ?? diffTitleForFiles(leftFile, rightFile);

    await commands.executeCommand<void>(
        "vscode.diff",
        leftFileWithoutLeftFiles,
        rightUriWithLeftInfo,
        fullTitle
    );
}

export async function diffDefault(
    resource: Resource,
    diffType?: DiffType
): Promise<void> {
    if (resource.FileType.base === FileType.BINARY) {
        const uri = PerforceUri.fromUri(resource.resourceUri, { command: "fstat" });
        await workspace.openTextDocument(uri).then(doc => window.showTextDocument(doc));
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
    await diffFiles(left.uri, right, getTitle(resource, left.title, diffType));
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
                return {
                    title:
                        Path.basename(resource.resourceUri.fsPath) +
                        "@=" +
                        resource.change,
                    uri: PerforceUri.fromUriWithRevision(
                        resource.resourceUri,
                        "@=" + resource.change
                    )
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
                    title: Path.basename(resource.resourceUri.fsPath) + "#0",
                    uri: emptyDoc
                };
            case Status.MOVE_ADD:
                // diff against the old file if it is known (always a depot path)
                return {
                    title: resource.fromFile
                        ? Path.basename(resource.fromFile.fsPath) +
                          "#" +
                          resource.fromEndRev
                        : "Depot Version",
                    uri: resource.fromFile ?? emptyDoc
                };
            case Status.INTEGRATE:
            case Status.EDIT:
            case Status.DELETE:
            case Status.MOVE_DELETE:
                return {
                    title:
                        Path.basename(resource.resourceUri.fsPath) +
                        "#" +
                        resource.workingRevision,
                    uri: PerforceUri.fromUriWithRevision(
                        resource.resourceUri,
                        resource.workingRevision
                    )
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
                return resource.resourceUri;
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
    const basename = Path.basename(resource.resourceUri.fsPath);

    let text = "";
    switch (diffType) {
        case DiffType.SHELVE_V_DEPOT:
            text = leftTitle + " ⟷ " + basename + "@=" + resource.change;
            break;
        case DiffType.WORKSPACE_V_SHELVE:
            text = leftTitle + " ⟷ " + basename + " (workspace)";
            break;
        case DiffType.WORKSPACE_V_DEPOT:
            text = leftTitle + " ⟷ " + basename + " (workspace)";
    }
    return text;
}
