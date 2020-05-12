import { pipe } from "@arrows/composition";
import {
    flagMapper,
    makeSimpleCommand,
    asyncOuputHandler,
    splitIntoLines,
} from "../CommandUtils";
import { RawField } from "../CommonTypes";
import { getBasicField, parseSpecOutput } from "../SpecParser";
import { isTruthy } from "../../TsUtils";

export type Job = {
    job?: string;
    status?: string;
    user?: string;
    description?: string;
    rawFields: RawField[];
};

function mapToJobFields(rawFields: RawField[]): Job {
    return {
        job: getBasicField(rawFields, "Job")?.[0].trim(),
        status: getBasicField(rawFields, "Status")?.[0].trim(),
        user: getBasicField(rawFields, "User")?.[0].trim(),
        description: getBasicField(rawFields, "Description")?.join("\n"),
        rawFields,
    };
}

const parseJobSpec = pipe(parseSpecOutput, mapToJobFields);

export type JobOptions = {
    existingJob?: string;
};

const jobFlags = flagMapper<JobOptions>([], "existingJob", ["-o"], {
    lastArgIsFormattedArray: true,
});

export const outputJob = makeSimpleCommand("job", jobFlags);

export const getJob = asyncOuputHandler(outputJob, parseJobSpec);

export type JobFix = {
    job: string;
    chnum: string;
    date: string;
    user: string;
    client: string;
    status: string;
};

function parseJobFix(line: string): JobFix | undefined {
    const matches = /^(\S*) fixed by change (\d+) on (\S*) by (\S*?)@(\S*) \((.*?)\)$/.exec(
        line
    );
    if (matches) {
        const [, job, chnum, date, user, client, status] = matches;
        return {
            job,
            chnum,
            date,
            user,
            client,
            status,
        };
    }
}

function parseFixesOutuput(output: string) {
    // example:
    // job000001 fixed by change 53 on 2020/04/04 by zogge@default (closed)
    const lines = splitIntoLines(output);
    return lines.map(parseJobFix).filter(isTruthy);
}

export type FixesOptions = {
    job?: string;
};

const fixesFlags = flagMapper<FixesOptions>([["j", "job"]]);
const fixesCommand = makeSimpleCommand("fixes", fixesFlags);

export const fixes = asyncOuputHandler(fixesCommand, parseFixesOutuput);

export type InputRawJobSpecOptions = {
    input: string;
};

export type CreatedJob = {
    rawOutput: string;
    job?: string;
};

function parseCreatedJob(createdStr: string): CreatedJob {
    const matches = /Job (\S*) (saved|not changed)/.exec(createdStr);

    return {
        rawOutput: createdStr,
        job: matches?.[1],
    };
}

const inputRawJobCommand = makeSimpleCommand(
    "job",
    () => ["-i"],
    (options: InputRawJobSpecOptions) => {
        return {
            input: options.input,
        };
    }
);

export const inputRawJobSpec = asyncOuputHandler(inputRawJobCommand, parseCreatedJob);
