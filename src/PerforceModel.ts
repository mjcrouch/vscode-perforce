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

interface CommandOptions {
    resource: vscode.Uri;
}

const withPromise = <I, R>(fn: (input: I) => R) => async (
    arg: Promise<I>
): Promise<R> => {
    return fn(await arg);
};

const runPerforceCommand = (args: PerforceCommand) =>
    Utils.runCommand(args.resource, args.command, args.params);

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
