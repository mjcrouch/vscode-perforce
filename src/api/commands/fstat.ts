import * as vscode from "vscode";
import {
    flagMapper,
    makeSimpleCommand,
    splitIntoChunks,
    mergeAll,
    splitIntoSections,
} from "../CommandUtils";
import { FstatInfo, PerforceFile } from "../CommonTypes";
import { isTruthy } from "../../TsUtils";
import { splitIntoLines } from "../CommandUtils";

export interface FstatOptions {
    depotPaths: PerforceFile[];
    chnum?: string;
    limitToShelved?: boolean;
    outputPendingRecord?: boolean;
    limitToOpened?: boolean;
    limitToClient?: boolean;
}

function parseZTagField(field: string) {
    // examples:
    // ... depotFile //depot/testArea/stuff
    // ... mapped
    const matches = /[.]{3} (\w+)[ ]*(.+)?/.exec(field);
    if (matches) {
        return { [matches[1]]: matches[2] ? matches[2] : "true" } as Partial<FstatInfo>;
    }
}

function parseZTagBlock(block: string) {
    return splitIntoLines(block).map(parseZTagField).filter(isTruthy);
}

function parseFstatSection(file: string) {
    return mergeAll({ depotFile: "" }, ...parseZTagBlock(file)) as FstatInfo;
}

function parseFstatOutput(fstatOutput: string) {
    const all = splitIntoSections(fstatOutput.trim()).map((file) =>
        parseFstatSection(file)
    );
    return all;
}

const fstatFlags = flagMapper<FstatOptions>(
    [
        ["e", "chnum"],
        ["Or", "outputPendingRecord"],
        ["Rs", "limitToShelved"],
        ["Ro", "limitToOpened"],
        ["Rc", "limitToClient"],
    ],
    "depotPaths"
);

const fstatBasic = makeSimpleCommand("fstat", fstatFlags).ignoringStdErr;

export async function getFstatInfo(resource: vscode.Uri, options: FstatOptions) {
    const chunks = splitIntoChunks(options.depotPaths);
    const promises = chunks.map((paths) =>
        fstatBasic(resource, { ...options, ...{ depotPaths: paths } })
    );

    const fstats = await Promise.all(promises);
    return fstats.flatMap((output) => parseFstatOutput(output));
}

/**
 * perform an fstat and map the results back to the right files
 * ONLY WORKS IF THE PASSED IN PATHS ARE DEPOT PATH STRINGS without any revision specifiers
 * (TODO - this whole module could be reworked to something better...)
 */
export async function getFstatInfoMapped(resource: vscode.Uri, options: FstatOptions) {
    const all = await getFstatInfo(resource, options);
    return options.depotPaths.map((file) => all.find((fs) => fs["depotFile"] === file));
}
