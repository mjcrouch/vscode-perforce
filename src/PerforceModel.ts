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

type PerforceCommand = {
    resource: vscode.Uri;
    command: string;
    params: Utils.CommandParams;
};

export type FstatInfo = {
    depotFile: string;
    [key: string]: string;
};

interface CommandOptions {
    resource: vscode.Uri;
}

const splitArray = <T>(chunkSize: number) => {
    return (arr: T[]): T[][] => {
        const ret: T[][] = [];
        for (let i = 0; i < arr.length; i += chunkSize) {
            ret.push(arr.slice(i, i + chunkSize));
        }
        return ret;
    };
};

const splitIntoChunks = <T>(arr: T[]) => splitArray<T>(32)(arr);

const withPromise = <I, R>(fn: (input: I) => R) => async (
    arg: Promise<I>
): Promise<R> => {
    return fn(await arg);
};

const runPerforceCommand = (args: PerforceCommand) =>
    Utils.runCommand(args.resource, args.command, args.params);

const runAllCommands = async (commands: PerforceCommand[]) =>
    await Promise.all(commands.map(args => runPerforceCommand(args)));

const makePerforceCommand = (
    options: CommandOptions,
    command: string,
    params: Utils.CommandParams
): PerforceCommand => {
    return {
        resource: options.resource,
        command,
        params
    };
};

const parseRawField = (value: string) => {
    if (value.startsWith("\n")) {
        value = value.slice(1);
    }
    return value.split("\n").map(line => line.replace(/^\t/, ""));
};

const parseRawFields = (parts: string[]): ChangeFieldRaw[] =>
    parts.map(field => {
        const colPos = field.indexOf(":");
        const name = field.slice(0, colPos);
        const value = parseRawField(field.slice(colPos + 1));
        return { name, value };
    });

const getBasicField = (fields: ChangeFieldRaw[], field: string) => {
    return fields.find(i => i.name === field)?.value;
};

const splitIntoSections = (str: string) => str.split(/\n\r?\n/);
const excludeComments = (parts: string[]) =>
    parts.filter(part => !part.startsWith("#") && part !== "");

const mapToChangeFields = (rawFields: ChangeFieldRaw[]): ChangeSpec => {
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
};

const parseChangeSpec = pipe(
    splitIntoSections,
    excludeComments,
    parseRawFields,
    mapToChangeFields
);

export interface ChangeSpecOptions extends CommandOptions {
    existingChangelist?: string;
}

const makeChangeSpecCommand = (options: ChangeSpecOptions): PerforceCommand => {
    return makePerforceCommand(options, "change", {
        prefixArgs:
            "-o" + (options.existingChangelist ? "-c " + options.existingChangelist : "")
    });
};

const concatIfDefined = <T, R>(...fns: ((arg: T) => R | undefined)[]) => {
    return (arg: T) =>
        fns.reduce((all, fn) => {
            const val = fn(arg);
            return val !== undefined ? all.concat([val]) : all;
        }, [] as R[]);
};

const getChangeAsRawField = (spec: ChangeSpec): ChangeFieldRaw | undefined => {
    return spec.change ? { name: "Change", value: [spec.change] } : undefined;
};
const getDescriptionAsRawField = (spec: ChangeSpec): ChangeFieldRaw | undefined => {
    return spec.description
        ? { name: "Description", value: spec.description.split("\n") }
        : undefined;
};
const getFilesAsRawField = (spec: ChangeSpec): ChangeFieldRaw | undefined => {
    return spec.files
        ? {
              name: "Files",
              value: spec.files.map(file => file.depotPath + "\t# " + file.action)
          }
        : undefined;
};
const getDefinedSpecFields = (spec: ChangeSpec): ChangeFieldRaw[] => {
    return concatIfDefined(
        getChangeAsRawField,
        getDescriptionAsRawField,
        getFilesAsRawField
    )(spec);
};

export const getChangeSpec = pipe(
    makeChangeSpecCommand,
    runPerforceCommand,
    withPromise(parseChangeSpec)
);

export interface InputChangeSpecOptions extends CommandOptions {
    spec: ChangeSpec;
}

const makeChangeInputCommand = (options: InputChangeSpecOptions): PerforceCommand => {
    return makePerforceCommand(options, "change", {
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
};

export type CreatedChangelist = {
    rawOutput: string;
    chnum?: string;
};
const parseCreatedChangelist = (createdStr: string): CreatedChangelist => {
    const matches = new RegExp(/Change\s(\d+)\screated/).exec(createdStr);
    return {
        rawOutput: createdStr,
        chnum: matches?.[1]
    };
};

export const inputChangeSpec = pipe(
    makeChangeInputCommand,
    runPerforceCommand,
    withPromise(parseCreatedChangelist)
);

export interface FStatOptions extends CommandOptions {
    depotPaths: string[];
    chnum?: string;
    limitToShelved?: boolean;
    outputPendingRecord?: boolean;
}

const getFstatOptions = (options: FStatOptions) => {
    return [
        options.chnum ? "-e " + options.chnum : "",
        options.outputPendingRecord ? "-Or" : "",
        options.limitToShelved ? "-Rs" : ""
    ].filter(opt => opt !== "");
};

const makeFstatCommands = (options: FStatOptions): PerforceCommand[] => {
    return splitIntoChunks(options.depotPaths).map(paths =>
        makePerforceCommand(options, "fstat", {
            prefixArgs: getFstatOptions(options)
                .concat('"' + paths.join('" "') + '"')
                .join(" ")
        })
    );
};

const parseFstatOutput = (fstatOutput: string) => {
    return fstatOutput
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
};

const applyToEach = <T, R>(fn: (arg: T) => R) => (args: T[]) =>
    args.map(item => fn(item));

const flatten = <T>(arg: T[][]): T[] => arg.flat();

export const getFstatInfo = pipe(
    makeFstatCommands,
    runAllCommands,
    withPromise(pipe(applyToEach(parseFstatOutput), flatten))
);
