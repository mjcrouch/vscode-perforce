import {
    flagMapper,
    makeSimpleCommand,
    asyncOuputHandler,
    splitIntoLines,
    removeIndent,
    sectionArrayBy,
} from "../CommandUtils";
import { ChangeInfo, PerforceFile } from "../CommonTypes";
import { isTruthy, parseDate } from "../../TsUtils";

export enum ChangelistStatus {
    PENDING = "pending",
    SHELVED = "shelved",
    SUBMITTED = "submitted",
}

export interface ChangesOptions {
    client?: string;
    status?: ChangelistStatus;
    user?: string;
    maxChangelists?: number;
    files?: PerforceFile[];
}

const changes = makeSimpleCommand(
    "changes",
    flagMapper<ChangesOptions>(
        [
            ["c", "client"],
            ["s", "status"],
            ["u", "user"],
            ["m", "maxChangelists"],
        ],
        "files",
        ["-l"]
    )
);

function parseChangelistHeader(
    value: string
): Omit<ChangeInfo, "description"> | undefined {
    // example:
    // Change 45 on 2020/02/15 by super@matto 'a new changelist with a much lo'

    // with -t flag
    // Change 45 on 2020/02/15 18:48:43 by super@matto 'a new changelist with a much lo'
    const matches = /Change\s(\d+)\son\s(.+)\sby\s(.+)@(\S+)(?:\s\*(.+)\*)?/.exec(value);

    if (matches) {
        const [, chnum, date, user, client, status] = matches;
        const isPending = status === "pending";
        const parsedDate = parseDate(date);
        return { chnum, date: parsedDate, user, client, isPending };
    }
}

function parseChangelist(lines: string[]): ChangeInfo | undefined {
    const [header, ...descLines] = lines;
    const parsed = parseChangelistHeader(header);
    if (!parsed) {
        return;
    }
    const description = removeIndent(descLines.filter((line) => line.startsWith("\t")));
    return { ...parsed, description };
}

function parseChangesOutput(output: string): ChangeInfo[] {
    const lines = splitIntoLines(output);
    const changes = sectionArrayBy(lines, (line) => line.startsWith("Change"));
    return changes.map(parseChangelist).filter(isTruthy);
}

export const getChangelists = asyncOuputHandler(changes, parseChangesOutput);
