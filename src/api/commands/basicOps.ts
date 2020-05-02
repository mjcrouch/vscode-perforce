import {
    flagMapper,
    makeSimpleCommand,
    asyncOuputHandler,
    splitIntoLines,
} from "../CommandUtils";
import { PerforceFile, NoOpts } from "../CommonTypes";
import * as vscode from "vscode";
import * as PerforceUri from "../../PerforceUri";
import { isTruthy } from "../../TsUtils";

export type DeleteChangelistOptions = {
    chnum: string;
};

const deleteChangelistFlags = flagMapper<DeleteChangelistOptions>([["d", "chnum"]]);

export const deleteChangelist = makeSimpleCommand("change", deleteChangelistFlags);

export type SubmitChangelistOptions = {
    chnum?: string;
    description?: string;
    file?: PerforceFile;
};

const submitFlags = flagMapper<SubmitChangelistOptions>(
    [
        ["c", "chnum"],
        ["d", "description"],
    ],
    "file"
);

const submitChangelistCommand = makeSimpleCommand("submit", submitFlags);

function parseSubmitOutput(output: string) {
    const matches = /Change (\d+) submitted/.exec(output);
    return {
        rawOutput: output,
        chnum: matches?.[1],
    };
}

export const submitChangelist = asyncOuputHandler(
    submitChangelistCommand,
    parseSubmitOutput
);

export interface RevertOptions {
    paths: PerforceFile[];
    chnum?: string;
    unchanged?: boolean;
}

const revertFlags = flagMapper<RevertOptions>(
    [
        ["a", "unchanged"],
        ["c", "chnum"],
    ],
    "paths"
);

export const revert = makeSimpleCommand("revert", revertFlags);

export interface DeleteOptions {
    chnum?: string;
    paths: PerforceFile[];
}

const deleteFlags = flagMapper<DeleteOptions>([["c", "chnum"]], "paths");

export const del = makeSimpleCommand("delete", deleteFlags);

//#region Shelving

export interface ShelveOptions {
    chnum?: string;
    force?: boolean;
    delete?: boolean;
    paths?: PerforceFile[];
}

const shelveFlags = flagMapper<ShelveOptions>(
    [
        ["f", "force"],
        ["d", "delete"],
        ["c", "chnum"],
    ],
    "paths"
);

export const shelve = makeSimpleCommand("shelve", shelveFlags);

export interface UnshelveOptions {
    shelvedChnum: string;
    toChnum?: string;
    force?: boolean;
    branchMapping?: string;
    paths?: PerforceFile[];
}

const unshelveFlags = flagMapper<UnshelveOptions>(
    [
        ["f", "force"],
        ["s", "shelvedChnum"],
        ["c", "toChnum"],
        ["b", "branchMapping"],
    ],
    "paths"
);

export type UnshelvedFiles = {
    files: UnshelvedFile[];
    warnings: ResolveWarning[];
};

type ResolveWarning = {
    depotPath: string;
    resolvePath: string;
};

type UnshelvedFile = {
    depotPath: string;
    operation: string;
};

function isUnshelvedFile(obj: any): obj is UnshelvedFile {
    return obj && obj.depotPath !== undefined && obj.operation !== undefined;
}

function isResolveWarning(obj: any): obj is ResolveWarning {
    return obj && obj.depotPath !== undefined && obj.resolvePath !== undefined;
}

function parseResolveMessage(line: string): ResolveWarning | undefined {
    const matches = /\.{3} (.*?) - must resolve (.*?) before submitting/.exec(line);
    if (matches) {
        const [, depotPath, resolvePath] = matches;
        return {
            depotPath,
            resolvePath,
        };
    }
}

function parseUnshelveMessage(line: string): UnshelvedFile | undefined {
    const matches = /(.*?) - unshelved, opened for (.*)/.exec(line);
    if (matches) {
        const [, depotPath, operation] = matches;
        return {
            depotPath,
            operation,
        };
    }
}

function parseUnshelveLine(line: string) {
    return line.startsWith("...")
        ? parseResolveMessage(line)
        : parseUnshelveMessage(line);
}

function parseUnshelveOutput(output: string): UnshelvedFiles {
    const lines = splitIntoLines(output);
    const parsed = lines.map((line) => parseUnshelveLine(line)).filter(isTruthy);
    return {
        files: parsed.filter(isUnshelvedFile),
        warnings: parsed.filter(isResolveWarning),
    };
}

const unshelveCommand = makeSimpleCommand("unshelve", unshelveFlags);

export const unshelve = asyncOuputHandler(unshelveCommand, parseUnshelveOutput);

//#endregion

export interface FixJobOptions {
    chnum: string;
    jobId: string;
    removeFix?: boolean;
}

const fixJobFlags = flagMapper<FixJobOptions>(
    [
        ["c", "chnum"],
        ["d", "removeFix"],
    ],
    "jobId"
);

export const fixJob = makeSimpleCommand("fix", fixJobFlags);

export interface ReopenOptions {
    chnum: string;
    files: PerforceFile[];
}

const reopenFlags = flagMapper<ReopenOptions>([["c", "chnum"]], "files");

export const reopenFiles = makeSimpleCommand("reopen", reopenFlags);

export interface SyncOptions {
    files?: PerforceFile[];
}

const syncFlags = flagMapper<SyncOptions>([], "files");

export const sync = makeSimpleCommand("sync", syncFlags);

function parseInfo(output: string): Map<string, string> {
    const map = new Map<string, string>();
    const lines = output.trim().split(/\r?\n/);

    for (let i = 0, n = lines.length; i < n; ++i) {
        // Property Name: Property Value
        const matches = /([^:]+): (.+)/.exec(lines[i]);

        if (matches) {
            map.set(matches[1], matches[2]);
        }
    }

    return map;
}

export const info = makeSimpleCommand("info", () => []);

export const getInfo = asyncOuputHandler(info, parseInfo);

export interface HaveFileOptions {
    file: PerforceFile;
}

const haveFileFlags = flagMapper<HaveFileOptions>([], "file", [], {
    ignoreRevisionFragments: true,
});

export type HaveFile = {
    depotPath: string;
    revision: string;
    depotUri: vscode.Uri;
    localUri: vscode.Uri;
};

function parseHaveOutput(resource: vscode.Uri, output: string): HaveFile | undefined {
    const matches = /^(.+)#(\d+) - (.+)/.exec(output);

    if (matches) {
        const [, depotPath, revision, localPath] = matches;
        const depotUri = PerforceUri.fromDepotPath(resource, matches[1], matches[2]);
        const localUri = vscode.Uri.file(localPath);
        return { depotPath, revision, depotUri, localUri };
    }
}

// TODO tidy this up

const haveFileCmd = makeSimpleCommand("have", haveFileFlags);

/**
 * Checks if we `have` a file.
 * @param resource Context for where to run the command
 * @param options Options for the command
 * @returns a perforce URI representing the depot path, revision etc
 */
export async function have(resource: vscode.Uri, options: HaveFileOptions) {
    const output = await haveFileCmd.ignoringStdErr(resource, options);
    return parseHaveOutput(resource, output);
}

// if stdout has any value, we have the file (stderr indicates we don't)
export const haveFile = asyncOuputHandler(haveFileCmd.ignoringAndHidingStdErr, isTruthy);

export type LoginOptions = {
    password: string;
};

export const login = makeSimpleCommand(
    "login",
    () => [],
    (options: LoginOptions) => {
        return {
            input: options.password,
        };
    }
);

const getLoggedInStatus = makeSimpleCommand<NoOpts>("login", () => ["-s"]);

export async function isLoggedIn(resource: vscode.Uri): Promise<boolean> {
    try {
        await getLoggedInStatus(resource, {});
        return true;
    } catch {
        return false;
    }
}

export const logout = makeSimpleCommand<NoOpts>("logout", () => []);

export type ResolveOptions = {
    chnum?: string;
    reresolve?: boolean;
    files?: PerforceFile[];
};

const resolveFlags = flagMapper<ResolveOptions>(
    [
        ["c", "chnum"],
        ["f", "reresolve"],
    ],
    "files",
    [],
    {
        ignoreRevisionFragments: true,
    }
);

export const resolve = makeSimpleCommand("resolve", resolveFlags, () => {
    return { useTerminal: true };
});

export type AddOptions = {
    chnum?: string;
    files: PerforceFile[];
};
const addFlags = flagMapper<AddOptions>([["c", "chnum"]], "files");

export const add = makeSimpleCommand("add", addFlags);

export type EditOptions = {
    chnum?: string;
    files: PerforceFile[];
};
const editFlags = flagMapper<EditOptions>([["c", "chnum"]], "files");

export const edit = makeSimpleCommand("edit", editFlags);

export type MoveOptions = {
    chnum?: string;
    fromToFile: [PerforceFile, PerforceFile];
};
const moveFlags = flagMapper<MoveOptions>([["c", "chnum"]], "fromToFile");

export const move = makeSimpleCommand("move", moveFlags);
