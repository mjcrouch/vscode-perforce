import * as vscode from "vscode";
import { Utils } from "./Utils";

import { pipe } from "@arrows/composition";

type ChangeSpec = {
    description?: string;
    files?: ChangeSpecFile[];
    change?: string;
    rawFields: ChangeFieldRaw[];
};

type ChangeFieldRaw = {
    name: string;
    value: string[];
};

type ChangeSpecFile = {
    depotPath: string;
    action: string;
};

export type ChangeInfo = {
    chnum: string;
    description: string;
    date: string;
    user: string;
    client: string;
    status: string;
};

export type FstatInfo = {
    depotFile: string;
    [key: string]: string;
};

export type PerforceFileSpec = {
    /** The filesystem path - without escaping special characters */
    fsPath: string;
    /** Optional suffix, e.g. #1, @=2 */
    suffix?: string;
};

type PerforceFile = PerforceFileSpec | string;

export function isPerforceFileSpec(obj: any): obj is PerforceFileSpec {
    return obj && obj.fsPath;
}

function splitArray<T>(chunkSize: number) {
    return (arr: T[]): T[][] => {
        const ret: T[][] = [];
        for (let i = 0; i < arr.length; i += chunkSize) {
            ret.push(arr.slice(i, i + chunkSize));
        }
        return ret;
    };
}

type CmdArgs = (string | undefined)[];

function makeFlag(flag: string, value: string | boolean | undefined) {
    if (typeof value === "string") {
        return value ? "-" + flag + " " + value : undefined;
    }
    return value ? "-" + flag : undefined;
}

function makeFlags(
    pairs: [string, string | boolean | undefined][],
    lastArgs?: (string | undefined)[]
) {
    return pairs.map(pair => makeFlag(pair[0], pair[1])).concat(...(lastArgs ?? []));
}

type FlagValue = string | boolean | PerforceFile[] | string[] | undefined;
type FlagDefinition<T> = {
    [P in keyof T]: FlagValue;
};

function lastArgAsStrings(
    lastArg: FlagValue,
    lastArgIsFormatted?: boolean
): (string | undefined)[] | undefined {
    if (typeof lastArg === "boolean") {
        return undefined;
    }
    if (typeof lastArg === "string") {
        return [lastArg];
    }
    if (lastArgIsFormatted) {
        return lastArg as string[];
    }
    return pathsToArgs(lastArg);
}

function flagMapper<P extends FlagDefinition<P>>(
    flagNames: [string, keyof P][],
    lastArg?: keyof P,
    lastArgIsFormatted?: boolean
) {
    return (options: P): CmdArgs => {
        return makeFlags(
            flagNames.map(fn => {
                return [fn[0], options[fn[1]] as string | boolean | undefined];
            }),
            lastArg
                ? lastArgAsStrings(options[lastArg] as FlagValue, lastArgIsFormatted)
                : undefined
        );
    };
}

const joinDefinedArgs = (args: CmdArgs) => args?.filter(arg => !!arg).join(" ");

function pathsToArgs(arr?: (string | PerforceFileSpec)[]) {
    return (
        arr?.map(path => {
            if (isPerforceFileSpec(path)) {
                return (
                    '"' +
                    Utils.expansePath(path.fsPath) +
                    (path.suffix ? path.suffix : "") +
                    '"'
                );
            } else if (path) {
                return '"' + path + '"';
            }
        }) ?? []
    );
}

const splitIntoChunks = <T>(arr: T[]) => splitArray<T>(32)(arr);

const runPerforceCommand = Utils.runCommand;

function makeSimpleCommand<T>(command: string, fn: (opts: T) => CmdArgs) {
    return (resource: vscode.Uri, options: T) =>
        runPerforceCommand(resource, command, {
            prefixArgs: joinDefinedArgs(fn(options))
        });
}

function asyncOuputHandler<T extends any[], M, O>(
    fn: (...args: T) => Promise<M>,
    mapper: (arg: M) => O
) {
    return async (...args: T) => mapper(await fn(...args));
}

function parseRawField(value: string) {
    if (value.startsWith("\n")) {
        value = value.slice(1);
    }
    return value.split("\n").map(line => line.replace(/^\t/, ""));
}

//#region Changelists

function parseRawFields(parts: string[]): ChangeFieldRaw[] {
    return parts.map(field => {
        const colPos = field.indexOf(":");
        const name = field.slice(0, colPos);
        const value = parseRawField(field.slice(colPos + 1));
        return { name, value };
    });
}

const getBasicField = (fields: ChangeFieldRaw[], field: string) =>
    fields.find(i => i.name === field)?.value;
const splitIntoSections = (str: string) => str.split(/\n\r?\n/);
const excludeNonFields = (parts: string[]) =>
    parts.filter(part => !part.startsWith("#") && part !== "");

function mapToChangeFields(rawFields: ChangeFieldRaw[]): ChangeSpec {
    return {
        change: getBasicField(rawFields, "Change")?.[0],
        description: getBasicField(rawFields, "Description")?.join("\n"),
        files: getBasicField(rawFields, "Files")?.map(file => {
            const endOfFileStr = file.indexOf("#");
            return {
                depotPath: file.slice(0, endOfFileStr).trim(),
                action: file.slice(endOfFileStr + 2)
            };
        }),
        rawFields
    };
}

const parseChangeSpec = pipe(
    splitIntoSections,
    excludeNonFields,
    parseRawFields,
    mapToChangeFields
);

export type ChangeSpecOptions = {
    existingChangelist?: string;
};

function concatIfDefined<T, R>(...fns: ((arg: T) => R | undefined)[]) {
    return (arg: T) =>
        fns.reduce((all, fn) => {
            const val = fn(arg);
            return val !== undefined ? all.concat([val]) : all;
        }, [] as R[]);
}

const getChangeAsRawField = (spec: ChangeSpec) =>
    spec.change ? { name: "Change", value: [spec.change] } : undefined;

const getDescriptionAsRawField = (spec: ChangeSpec) =>
    spec.description
        ? { name: "Description", value: spec.description.split("\n") }
        : undefined;

const getFilesAsRawField = (spec: ChangeSpec) =>
    spec.files
        ? {
              name: "Files",
              value: spec.files.map(file => file.depotPath + "\t# " + file.action)
          }
        : undefined;

function getDefinedSpecFields(spec: ChangeSpec): ChangeFieldRaw[] {
    return concatIfDefined(
        getChangeAsRawField,
        getDescriptionAsRawField,
        getFilesAsRawField
    )(spec);
}

export async function getChangeSpec(resource: vscode.Uri, options: ChangeSpecOptions) {
    const output = await runPerforceCommand(resource, "change", {
        prefixArgs:
            "-o" + (options.existingChangelist ? " " + options.existingChangelist : "")
    });
    return parseChangeSpec(output);
}

export type InputChangeSpecOptions = {
    spec: ChangeSpec;
};

export type CreatedChangelist = {
    rawOutput: string;
    chnum?: string;
};

function parseCreatedChangelist(createdStr: string): CreatedChangelist {
    const matches = new RegExp(/Change\s(\d+)\screated/).exec(createdStr);
    return {
        rawOutput: createdStr,
        chnum: matches?.[1]
    };
}

export async function inputChangeSpec(
    resource: vscode.Uri,
    options: InputChangeSpecOptions
) {
    const output = await runPerforceCommand(resource, "change", {
        input: getDefinedSpecFields(options.spec)
            .concat(
                options.spec.rawFields.filter(
                    field => !options.spec[field.name.toLowerCase() as keyof ChangeSpec]
                )
            )
            .map(field => field.name + ":\t" + field.value.join("\n\t"))
            .join("\n\n"),
        prefixArgs: "-i"
    });

    return parseCreatedChangelist(output);
}

export type DeleteChangelistOptions = {
    chnum: string;
};

const deleteChangelistFlags = flagMapper<DeleteChangelistOptions>([["d", "chnum"]]);

export function deleteChangelist(resource: vscode.Uri, options: DeleteChangelistOptions) {
    return runPerforceCommand(resource, "change", {
        prefixArgs: joinDefinedArgs(deleteChangelistFlags(options))
    });
}

//#endregion

//#region FSTAT

export interface FstatOptions {
    depotPaths: string[];
    chnum?: string;
    limitToShelved?: boolean;
    outputPendingRecord?: boolean;
}

function getFstatFlags(options: FstatOptions): CmdArgs {
    return makeFlags([
        ["e", options.chnum],
        ["Or", options.outputPendingRecord],
        ["Rs", options.limitToShelved]
    ]);
}

function parseFstatOutput(expectedFiles: string[], fstatOutput: string) {
    const all = fstatOutput
        .trim()
        .split(/\n\r?\n/)
        .map(file => {
            const lines = file.split("\n");
            const lineMap: FstatInfo = { depotFile: "" };
            lines.forEach(line => {
                // ... Key Value
                const matches = new RegExp(/[.]{3} (\w+)[ ]*(.+)?/).exec(line);
                if (matches) {
                    // A key may not have a value (e.g. `isMapped`).
                    // Treat these as flags and map them to 'true'.
                    lineMap[matches[1]] = matches[2] ? matches[2] : "true";
                }
            });
            return lineMap;
        });
    return expectedFiles.map(file => all.find(fs => fs["depotFile"] === file));
}

export async function getFstatInfo(resource: vscode.Uri, options: FstatOptions) {
    const chunks = splitIntoChunks(options.depotPaths);
    const promises = chunks.map(paths =>
        runPerforceCommand(resource, "fstat", {
            prefixArgs: joinDefinedArgs(
                getFstatFlags(options).concat(...pathsToArgs(paths))
            ),
            stdErrIsOk: true
        })
    );
    const fstats = await Promise.all(promises);
    return fstats.flatMap((output, i) => parseFstatOutput(chunks[i], output));
}

//#endregion

export type OpenedFileOptions = { chnum?: string };

function parseOpenedOutput(output: string): CmdArgs {
    return output
        .trim()
        .split("\n")
        .map(
            line =>
                /(.+)#(\d+)\s-\s([\w\/]+)\s(default\schange|change\s\d+)\s\(([\w\+]+)\)/.exec(
                    line
                )?.[1]
        )
        .filter((match): match is string => !!match);
}

const openedFlags = flagMapper<OpenedFileOptions>([["c", "chnum"]]);

const opened = makeSimpleCommand("opened", openedFlags);

export const getOpenedFiles = asyncOuputHandler(opened, parseOpenedOutput);

export type SubmitChangelistOptions = { chnum?: string; description?: string };

const submitFlags = flagMapper<SubmitChangelistOptions>([
    ["c", "chnum"],
    ["d", "description"]
]);

export const submitChangelist = makeSimpleCommand("submit", submitFlags);

export interface RevertOptions {
    paths: PerforceFile[];
    chnum?: string;
    unchanged?: boolean;
}

export const revertFlags = flagMapper<RevertOptions>(
    [
        ["a", "unchanged"],
        ["c", "chnum"]
    ],
    "paths"
);

export const revert = makeSimpleCommand("revert", revertFlags);

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
        ["c", "chnum"]
    ],
    "paths"
);

export const shelve = makeSimpleCommand("shelve", shelveFlags);

export interface UnshelveOptions {
    shelvedChnum: string;
    toChnum?: string;
    force?: boolean;
    paths?: PerforceFile[];
}

const unshelveFlags = flagMapper<UnshelveOptions>(
    [
        ["f", "force"],
        ["s", "shelvedChnum"],
        ["c", "toChnum"]
    ],
    "paths"
);

export const unshelve = makeSimpleCommand("unshelve", unshelveFlags);

//#endregion

export interface FixJobOptions {
    chnum: string;
    jobId: string;
    removeFix?: boolean;
}

const fixJobFlags = flagMapper<FixJobOptions>(
    [
        ["c", "chnum"],
        ["d", "removeFix"]
    ],
    "jobId"
);

export const fixJob = makeSimpleCommand("fix", fixJobFlags);

export interface ReopenOptions {
    chnum: string;
    files: PerforceFile[];
}

function getReopenFlags(options: ReopenOptions) {
    return makeFlags([["c", options.chnum]], pathsToArgs(options.files));
}

export const reopenFiles = makeSimpleCommand("reopen", getReopenFlags);

export interface SyncOptions {
    files?: PerforceFile[];
}

function getSyncFlags(options: SyncOptions) {
    return pathsToArgs(options.files);
}

export const sync = makeSimpleCommand("sync", getSyncFlags);

export enum ChangelistStatus {
    PENDING = "pending",
    SHELVED = "shelved",
    SUBMITTED = "submitted"
}
export interface ChangesOptions {
    client?: string;
    status?: ChangelistStatus;
}

function parseChangelistDescription(value: string): ChangeInfo | undefined {
    const matches = new RegExp(
        /Change\s(\d+)\son\s(.+)\sby\s(.+)@(.+)\s\*(.+)\*\s\'(.*)\'/
    ).exec(value);

    if (matches) {
        const [, chnum, date, user, client, status, description] = matches;
        return { chnum, date, user, client, status, description };
    }
}

function parseChangesOutput(output: string): ChangeInfo[] {
    return output
        .split(/\r?\n/)
        .map(parseChangelistDescription)
        .filter((cl): cl is ChangeInfo => !!cl);
}

function getChangesFlags(options: ChangesOptions) {
    return makeFlags([
        ["c", options.client],
        ["s", options.status]
    ]);
}

export const changes = asyncOuputHandler(
    makeSimpleCommand("changes", getChangesFlags),
    parseChangesOutput
);

export interface DescribeOptions {
    chnums: string[];
    omitDiffs?: boolean;
    shelved?: boolean;
}

function getDescribeFlags(options: DescribeOptions) {
    return makeFlags(
        [
            ["S", options.shelved],
            ["s", options.omitDiffs]
        ],
        options.chnums
    );
}

const describe = makeSimpleCommand("describe", getDescribeFlags);

export interface GetShelvedOptions {
    chnums: string[];
}

export type ShelvedChangeInfo = { chnum: number; paths: string[] };

function parseDescribeOuput(output: string): ShelvedChangeInfo[] {
    const shelved = output.trim().split("\n");
    if (shelved.length === 0) {
        return [];
    }

    const changes: ShelvedChangeInfo[] = [];
    shelved.forEach(open => {
        const chMatch = new RegExp(/^Change (\d+) by/).exec(open);
        if (chMatch) {
            changes.push({ chnum: parseInt(chMatch[1]), paths: [] });
        } else if (changes.length > 0) {
            const matches = new RegExp(/(\.+)\ (.*)#(.*) (.*)/).exec(open);
            if (matches) {
                changes[changes.length - 1].paths.push(matches[2]);
            }
        }
    });

    return changes.filter(c => c.paths.length > 0);
}

export async function getShelvedFiles(resource: vscode.Uri, options: GetShelvedOptions) {
    const output = await describe(resource, {
        chnums: options.chnums,
        omitDiffs: true,
        shelved: true
    });
    return parseDescribeOuput(output);
}
