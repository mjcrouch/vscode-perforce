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

export type FstatInfo = {
    depotFile: string;
    [key: string]: string;
};

function splitArray<T>(chunkSize: number) {
    return (arr: T[]): T[][] => {
        const ret: T[][] = [];
        for (let i = 0; i < arr.length; i += chunkSize) {
            ret.push(arr.slice(i, i + chunkSize));
        }
        return ret;
    };
}

const splitIntoChunks = <T>(arr: T[]) => splitArray<T>(32)(arr);

const runPerforceCommand = Utils.runCommand;

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

//#region FSTAT

export interface FstatOptions {
    depotPaths: string[];
    chnum?: string;
    limitToShelved?: boolean;
    outputPendingRecord?: boolean;
}

function getFstatFlags(options: FstatOptions) {
    return [
        options.chnum ? "-e " + options.chnum : "",
        options.outputPendingRecord ? "-Or" : "",
        options.limitToShelved ? "-Rs" : ""
    ].filter(opt => opt !== "");
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
            prefixArgs: getFstatFlags(options)
                .concat('"' + paths.join('" "') + '"')
                .join(" ")
        })
    );
    const fstats = await Promise.all(promises);
    return fstats.flatMap((output, i) => parseFstatOutput(chunks[i], output));
}

//#endregion

export type OpenedFileOptions = { chnum: string };

function parseOpenedOutput(output: string) {
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

export async function getOpenedFiles(resource: vscode.Uri, options: OpenedFileOptions) {
    const output = await runPerforceCommand(resource, "opened", {
        prefixArgs: options.chnum ? "-c " + options.chnum : undefined
    });
    return parseOpenedOutput(output);
}

export type SubmitChangelistOptions = { chnum?: string; description?: string };

function getSubmitFlags(options: SubmitChangelistOptions) {
    return [
        options.chnum ? "-c " + options.chnum : "",
        options.description ? "-d " + options.description : ""
    ].filter(opt => opt !== "");
}

export function submitChangelist(resource: vscode.Uri, options: SubmitChangelistOptions) {
    return runPerforceCommand(resource, "submit", {
        prefixArgs: getSubmitFlags(options).join(" ")
    });
}
