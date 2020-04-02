import * as vscode from "vscode";
import {
    flagMapper,
    makeSimpleCommand,
    extractSection,
    sectionArrayBy,
    splitIntoLines
} from "..//CommandUtils";
import { FixedJob } from "../CommonTypes";
import { isTruthy } from "../../TsUtils";

export interface DescribeOptions {
    chnums: string[];
    omitDiffs?: boolean;
    shelved?: boolean;
}

const describeFlags = flagMapper<DescribeOptions>(
    [
        ["S", "shelved"],
        ["s", "omitDiffs"]
    ],
    "chnums",
    [],
    { lastArgIsFormattedArray: true }
);

const describe = makeSimpleCommand("describe", describeFlags);

export type DepotFileOperation = {
    depotPath: string;
    revision: string;
    operation: string;
};

export type DescribedChangelist = {
    chnum: string;
    user: string;
    client: string;
    date: Date;
    isPending: boolean;
    description: string;
    affectedFiles: DepotFileOperation[];
    shelvedFiles: DepotFileOperation[];
};

export interface GetShelvedOptions {
    chnums: string[];
}

export type ShelvedChangeInfo = { chnum: number; paths: string[] };

function parseShelvedDescribeOuput(output: string): ShelvedChangeInfo[] {
    const allLines = splitIntoLines(output.trim());

    const changelists = sectionArrayBy(allLines, line => /^Change \d+ by/.test(line));

    return changelists
        .map(section => {
            const matches = section
                .slice(1)
                .map(line => /(\.+)\ (.*)#(.*) (.*)/.exec(line)?.[2])
                .filter(isTruthy);
            return { chnum: parseInt(section[0].split(" ")[1]), paths: matches };
        })
        .filter(isTruthy)
        .filter(c => c.paths.length > 0);
}

export async function getShelvedFiles(
    resource: vscode.Uri,
    options: GetShelvedOptions
): Promise<ShelvedChangeInfo[]> {
    if (options.chnums.length === 0) {
        return [];
    }
    const output = await describe(resource, {
        chnums: options.chnums,
        omitDiffs: true,
        shelved: true
    });
    return parseShelvedDescribeOuput(output);
}

// TODO can this be merged into common handling for describe output?
function parseFixedJobsOutput(output: string): FixedJob[] {
    /**
     * example:
     *
     * Jobs fixed ...
     *
     * job000001 on 2020/02/22 by super *open*
     *
     * \ta job
     * \thooray
     *
     * etc
     * Affected files ...
     */
    const allLines = splitIntoLines(output.trim());
    const subLines = extractSection(
        allLines,
        line => line.startsWith("Jobs fixed ..."),
        line => !line.startsWith("\t") && line.includes("files ...")
    );

    if (subLines) {
        return sectionArrayBy(subLines, line => /^\w*? on/.test(line)).map(job => {
            return {
                id: job[0].split(" ")[0],
                description: job
                    .slice(1)
                    .filter(line => line.startsWith("\t"))
                    .map(line => line.slice(1))
            };
        });
    }
    return [];
}

export interface GetFixedJobsOptions {
    chnum: string;
}

export async function getFixedJobs(resource: vscode.Uri, options: GetFixedJobsOptions) {
    const output = await describe(resource, {
        chnums: [options.chnum],
        omitDiffs: true
    });
    return parseFixedJobsOutput(output);
}
