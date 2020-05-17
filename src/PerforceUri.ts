import * as vscode from "vscode";
import * as Path from "path";

export type UriArguments = {
    workspace?: string;
    depot?: boolean;
    command?: string;
    p4Args?: string;
    leftUri?: string;
    haveRev?: string;
    diffStartFile?: string;
    depotName?: string;
    rev?: string;
};

type AnyUriArguments = {
    [key: string]: string | boolean | undefined;
};

export function isSameFileOrDepotPath(a: vscode.Uri, b: vscode.Uri) {
    if (isDepotUri(a) && isDepotUri(b)) {
        return getDepotPathFromDepotUri(a) === getDepotPathFromDepotUri(b);
    } else {
        return fsPathWithoutRev(a) === fsPathWithoutRev(b);
    }
}

export function getRevOrAtLabel(uri: vscode.Uri) {
    return uri.fragment;
}

export function revOrLabelAsSuffix(revOrAtLabel: string | undefined) {
    return revOrAtLabel
        ? revOrAtLabel.startsWith("@")
            ? revOrAtLabel
            : "#" + revOrAtLabel
        : "";
}

export function emptyFileUri() {
    return vscode.Uri.parse("perforce:EMPTY");
}

export function withoutRev(path: string, revOrAtLabel: string | undefined) {
    const revStr = revOrLabelAsSuffix(revOrAtLabel);
    if (revStr && path.endsWith(revStr)) {
        return path.slice(0, -revStr.length);
    }
    return path;
}

function uriWithoutRev(uri: vscode.Uri) {
    const path = withoutRev(uri.path, getRevOrAtLabel(uri));
    return uri.with({ path: path });
}

export function fsPathWithoutRev(uri: vscode.Uri) {
    return uriWithoutRev(uri).fsPath;
}

export function basenameWithoutRev(uri: vscode.Uri) {
    return Path.basename(fsPathWithoutRev(uri));
}

function uriWithRev(uri: vscode.Uri, revOrAtLabel: string | undefined) {
    return uri.with({
        path: uri.path + revOrLabelAsSuffix(revOrAtLabel),
        fragment: revOrAtLabel,
    });
}

export function getDepotPathFromDepotUri(uri: vscode.Uri): string {
    const args = decodeUriQuery(uri.query);
    return "//" + (args.depotName ?? uri.authority) + uriWithoutRev(uri).path;
}

function encodeParam(param: string, value?: string | boolean) {
    if (value !== undefined && typeof value === "string") {
        return encodeURIComponent(param) + "=" + encodeURIComponent(value);
    } else if (value === undefined || value) {
        return encodeURIComponent(param);
    }
}

export function parse(uri: string) {
    // because we're adding fragment identifiers to strings, we need to customise parsing
    // the URI might look like this for revision 1
    // perforce:/my/path#1?a=b#1
    // standard uri parsing produces { path: /my/path, fragment: #1?a=b#1 }
    // we want: path: /my/path#1 query: a=b, fragment: #1
    const parsed = vscode.Uri.parse(uri);
    const queryIndex = parsed.fragment.indexOf("?");
    const fragmentIndex = parsed.fragment.indexOf("#");
    if (queryIndex >= 0 || fragmentIndex >= 0) {
        return parsed.with({
            path:
                parsed.path +
                "#" +
                parsed.fragment.slice(0, queryIndex >= 0 ? queryIndex : fragmentIndex),
            fragment: fragmentIndex > 0 ? parsed.fragment.slice(fragmentIndex + 1) : "",
            query:
                queryIndex >= 0
                    ? parsed.fragment.slice(
                          queryIndex + 1,
                          fragmentIndex > 0 ? fragmentIndex : undefined
                      )
                    : undefined,
        });
    }
    return parsed;
}

/*
export function fromFsOrDepotPath(
    workspace: vscode.Uri,
    fsOrDepotPath: string,
    revision: string | undefined,
    isDepotPath: boolean
) {
    return isDepotPath ? fromDepotPath(workspace, fsOrDepotPath, revision) : fromUr;
}
*/

export function fromDepotPath(
    workspace: vscode.Uri,
    depotPath: string,
    revisionOrAtLabel: string | undefined
) {
    const baseUri = uriWithRev(
        vscode.Uri.parse("perforce:" + depotPath),
        revisionOrAtLabel
    );

    const depotName = depotPath.split("/")[2];
    return fromUri(baseUri, {
        depot: true,
        workspace: (getUsableWorkspace(workspace) ?? workspace).fsPath,
        depotName,
        rev: revisionOrAtLabel,
    });
}

function hasTruthyArg(uri: vscode.Uri, arg: keyof UriArguments): boolean {
    return !!decodeUriQuery(uri.query)[arg];
}

export function isDepotUri(uri: vscode.Uri): boolean {
    return hasTruthyArg(uri, "depot");
}

export function isUsableForWorkspace(uri: vscode.Uri): boolean {
    return (!isDepotUri(uri) && !!uri.fsPath) || hasTruthyArg(uri, "workspace");
}

export function getWorkspaceFromQuery(uri: vscode.Uri) {
    const ws = decodeUriQuery(uri.query).workspace;
    return ws ? vscode.Uri.file(ws) : undefined;
}

export function getUsableWorkspace(uri: vscode.Uri) {
    return !isDepotUri(uri) && !!uri.fsPath
        ? vscode.Uri.file(uriWithoutRev(uri).fsPath)
        : getWorkspaceFromQuery(uri);
}

export function forCommand(resource: vscode.Uri, command: string, p4Args: string) {
    return fromUri(vscode.Uri.parse("perforce:"), {
        command: command,
        p4Args: p4Args,
        workspace: resource.fsPath,
    });
}

export function fromUri(uri: vscode.Uri, otherArgs?: UriArguments) {
    const defaultArgs = {
        command: "print",
        p4Args: "-q",
    };
    return uri.with({
        scheme: "perforce",
        query: encodeQuery({
            ...defaultArgs,
            ...decodeUriQuery(uri.query), // use existing params
            ...otherArgs,
        }),
    });
}

export function fromUriWithRevision(perforceUri: vscode.Uri, revisionOrAtLabel: string) {
    return uriWithRev(
        fromUri(uriWithoutRev(perforceUri), {
            rev: revisionOrAtLabel,
        }),
        revisionOrAtLabel
    );
}

/**
 * Add the supplied arguments to a perforce uri - replacing any that are specified in both objects
 * @param uri the uri to add args to
 * @param args the arguments to add
 */
export function withArgs(
    uri: vscode.Uri,
    args: UriArguments,
    revisionOrAtLabel?: string
) {
    const curArgs = decodeUriQuery(uri.query);
    const newQuery =
        revisionOrAtLabel !== undefined
            ? encodeQuery({
                  ...curArgs,
                  ...args,
                  rev: revisionOrAtLabel,
              })
            : encodeQuery({
                  ...curArgs,
                  ...args,
              });
    return revisionOrAtLabel !== undefined
        ? uriWithRev(uriWithoutRev(uri).with({ query: newQuery }), revisionOrAtLabel)
        : uri.with({ query: newQuery });
}

export function encodeQuery(args: UriArguments) {
    return Object.entries(args)
        .filter((arg) => !!arg[1])
        .map((arg) => encodeParam(arg[0], arg[1]))
        .filter((arg) => !!arg)
        .join("&");
}

export function decodeUriQuery(query: string): UriArguments {
    const argArr = query?.split("&") ?? [];
    const allArgs: AnyUriArguments = {};
    argArr.forEach((arg) => {
        const parts = arg.split("=");
        const name = decodeURIComponent(parts[0]);
        const value = parts[1] ? decodeURIComponent(parts[1]) : true;
        allArgs[name as keyof AnyUriArguments] = value;
    });

    // a bit of a hack - could violate the type e.g. if allArgs has a bool for a string type
    return allArgs as UriArguments;
}
