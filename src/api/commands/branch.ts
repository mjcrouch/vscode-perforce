import {
    flagMapper,
    makeSimpleCommand,
    splitIntoLines,
    asyncOuputHandler,
} from "../CommandUtils";
import { isTruthy } from "../../TsUtils";

export interface BranchesOptions {
    nameFilter?: string;
    max?: number;
}

const branchesFlags = flagMapper<BranchesOptions>([
    ["E", "nameFilter"],
    ["m", "max"],
]);

const branchesCommand = makeSimpleCommand("branches", branchesFlags);

export type BranchInfo = {
    branch: string;
    date: string;
    description: string;
};

function parseBranchLine(line: string) {
    // example:
    // Branch br-project-x-dev1 2020/04/25 'Created by Amanda.Snozzlefwitch. '
    const matches = /^Branch (\S*) (.*?) '(.*)'$/.exec(line);
    if (matches) {
        const [, branch, date, description] = matches;
        return {
            branch,
            date,
            description,
        };
    }
}

function parseBranchesOutput(output: string) {
    const lines = splitIntoLines(output);
    return lines.map(parseBranchLine).filter(isTruthy);
}

export const branches = asyncOuputHandler(branchesCommand, parseBranchesOutput);
