import * as vscode from "vscode";
import { pipe } from "@arrows/composition";
import {
    concatIfOutputIsDefined,
    flagMapper,
    makeSimpleCommand,
    asyncOuputHandler,
    fixedParams,
    splitIntoChunks
} from "./CommandUtils";
import {
    FstatInfo,
    PerforceFile,
    ChangeInfo,
    FixedJob,
    ChangeFieldRaw,
    ChangeSpec
} from "./CommonTypes";

//#region Changelists

function parseRawField(value: string) {
    if (value.startsWith("\n")) {
        value = value.slice(1);
    }
    return value.split("\n").map(line => line.replace(/^\t/, ""));
}

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
    return concatIfOutputIsDefined(
        getChangeAsRawField,
        getDescriptionAsRawField,
        getFilesAsRawField
    )(spec);
}

export type ChangeSpecOptions = {
    existingChangelist?: string;
};

export const changeFlags = flagMapper<ChangeSpecOptions>(
    [],
    "existingChangelist",
    true,
    "-o"
);

const outputChange = makeSimpleCommand("change", changeFlags);

export const getChangeSpec = asyncOuputHandler(outputChange, parseChangeSpec);

export type InputChangeSpecOptions = {
    spec: ChangeSpec;
};

export type CreatedChangelist = {
    rawOutput: string;
    chnum?: string;
};

function parseCreatedChangelist(createdStr: string): CreatedChangelist {
    const matches = /Change\s(\d+)\screated/.exec(createdStr);
    return {
        rawOutput: createdStr,
        chnum: matches?.[1]
    };
}

const inputChange = makeSimpleCommand(
    "change",
    () => ["-i"],
    (options: InputChangeSpecOptions) => {
        return {
            input: getDefinedSpecFields(options.spec)
                .concat(
                    options.spec.rawFields.filter(
                        field =>
                            !options.spec[field.name.toLowerCase() as keyof ChangeSpec]
                    )
                )
                .map(field => field.name + ":\t" + field.value.join("\n\t"))
                .join("\n\n")
        };
    }
);

export const inputChangeSpec = asyncOuputHandler(inputChange, parseCreatedChangelist);

export type DeleteChangelistOptions = {
    chnum: string;
};

const deleteChangelistFlags = flagMapper<DeleteChangelistOptions>([["d", "chnum"]]);

export const deleteChangelist = makeSimpleCommand("change", deleteChangelistFlags);

//#endregion

//#region FSTAT

export interface FstatOptions {
    depotPaths: string[];
    chnum?: string;
    limitToShelved?: boolean;
    outputPendingRecord?: boolean;
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
                const matches = /[.]{3} (\w+)[ ]*(.+)?/.exec(line);
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

const fstatFlags = flagMapper<FstatOptions>(
    [
        ["e", "chnum"],
        ["Or", "outputPendingRecord"],
        ["Rs", "limitToShelved"]
    ],
    "depotPaths"
);

const fstatBasic = makeSimpleCommand(
    "fstat",
    fstatFlags,
    fixedParams({ stdErrIsOk: true })
);

export async function getFstatInfo(resource: vscode.Uri, options: FstatOptions) {
    const chunks = splitIntoChunks(options.depotPaths);
    const promises = chunks.map(paths =>
        fstatBasic(resource, { ...options, ...{ depotPaths: paths } })
    );

    const fstats = await Promise.all(promises);
    return fstats.flatMap((output, i) => parseFstatOutput(chunks[i], output));
}

//#endregion

export type OpenedFileOptions = { chnum?: string };

function parseOpenedOutput(output: string): string[] {
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

const opened = makeSimpleCommand(
    "opened",
    openedFlags,
    fixedParams({ stdErrIsOk: true }) // stderr when no files are opened
);

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

const reopenFlags = flagMapper<ReopenOptions>([["c", "chnum"]], "files");

export const reopenFiles = makeSimpleCommand("reopen", reopenFlags);

export interface SyncOptions {
    files?: PerforceFile[];
}

const syncFlags = flagMapper<SyncOptions>([], "files");

export const sync = makeSimpleCommand("sync", syncFlags);

export enum ChangelistStatus {
    PENDING = "pending",
    SHELVED = "shelved",
    SUBMITTED = "submitted"
}
export interface ChangesOptions {
    client?: string;
    status?: ChangelistStatus;
}

const changes = makeSimpleCommand(
    "changes",
    flagMapper<ChangesOptions>([
        ["c", "client"],
        ["s", "status"]
    ])
);

function parseChangelistDescription(value: string): ChangeInfo | undefined {
    const matches = /Change\s(\d+)\son\s(.+)\sby\s(.+)@(.+)\s\*(.+)\*\s\'(.*)\'/.exec(
        value
    );

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

export const getChangelists = asyncOuputHandler(changes, parseChangesOutput);

export interface DescribeOptions {
    chnums: string[];
    omitDiffs?: boolean;
    shelved?: boolean;
}

export const describeFlags = flagMapper<DescribeOptions>(
    [
        ["S", "shelved"],
        ["s", "omitDiffs"]
    ],
    "chnums",
    true
);

const describe = makeSimpleCommand("describe", describeFlags);

export interface GetShelvedOptions {
    chnums: string[];
}

export type ShelvedChangeInfo = { chnum: number; paths: string[] };

function parseShelvedDescribeOuput(output: string): ShelvedChangeInfo[] {
    const shelved = output.trim().split("\n");
    if (shelved.length === 0) {
        return [];
    }

    const changes: ShelvedChangeInfo[] = [];
    shelved.forEach(open => {
        const chMatch = /^Change (\d+) by/.exec(open);
        if (chMatch) {
            changes.push({ chnum: parseInt(chMatch[1]), paths: [] });
        } else if (changes.length > 0) {
            const matches = /(\.+)\ (.*)#(.*) (.*)/.exec(open);
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
    return parseShelvedDescribeOuput(output);
}

// TODO can this be merged into common handling for describe output?
function parseFixedJobsOutput(output: string) {
    const allLines = output.trim().split("\n");
    const startIndex = allLines.findIndex(line => line.startsWith("Jobs fixed ..."));
    if (startIndex >= 0) {
        const endIndex = allLines.findIndex(
            line => !line.startsWith("\t") && line.includes("files ...")
        );
        const subLines =
            endIndex > 0
                ? allLines.slice(startIndex + 1, endIndex)
                : allLines.slice(startIndex + 1);

        let curJob: FixedJob;
        const allJobs: FixedJob[] = [];
        subLines.forEach(line => {
            line = line.replace(/\r/g, "");
            if (!line.startsWith("\t")) {
                const matches = /^(.*?) on/.exec(line);
                if (matches) {
                    curJob = { id: matches[1], description: [] };
                    if (curJob) {
                        allJobs.push(curJob);
                    }
                }
            } else if (curJob) {
                curJob.description.push(line.slice(1));
            }
        });

        return allJobs;
    }
    return [];
}

export interface GetFixedJobsOptoins {
    chnum: string;
}

export async function getFixedJobs(resource: vscode.Uri, options: GetFixedJobsOptoins) {
    const output = await describe(resource, {
        chnums: [options.chnum],
        omitDiffs: true
    });
    return parseFixedJobsOutput(output);
}

function parseInfo(output: string): Map<string, string> {
    const map = new Map<string, string>();
    const lines = output.trim().split("\n");

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
    fsPath: string;
}

const haveFileFlags = flagMapper<HaveFileOptions>([], "fsPath");

const haveFileCmd = makeSimpleCommand(
    "have",
    haveFileFlags,
    fixedParams({ stdErrIsOk: true, hideStdErr: true })
);

// if stdout has any value, we have the file (stderr indicates we don't)
const handleHaveOutput = (output: string) => !!output;

export const haveFile = asyncOuputHandler(haveFileCmd, handleHaveOutput);
