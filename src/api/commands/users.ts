import {
    flagMapper,
    makeSimpleCommand,
    splitIntoLines,
    asyncOuputHandler,
} from "../CommandUtils";
import { isTruthy } from "../../TsUtils";

export interface UsersOptions {
    userFilters?: string[];
    max?: number;
}

const usersFlags = flagMapper<UsersOptions>([["m", "max"]], "userFilters", undefined, {
    lastArgIsFormattedArray: true,
});

const usersCommand = makeSimpleCommand("users", usersFlags);

export type UserInfo = {
    user: string;
    email: string;
    fullName: string;
    accessDate: string;
};

function parseUsersLine(line: string) {
    // example:
    // Amanda.Snozzlefwitch <am@snoz.lol> (Amanda Snozzlefwitch) accessed 2020/05/07
    const matches = /^(.*) <(.*)> \((.*)\) \S* (.*)$/.exec(line);
    if (matches) {
        const [, user, email, fullName, accessDate] = matches;
        return {
            user,
            email,
            fullName,
            accessDate,
        };
    }
}

function parseUsersOutput(output: string) {
    const lines = splitIntoLines(output);
    return lines.map(parseUsersLine).filter(isTruthy);
}

export const users = asyncOuputHandler(usersCommand, parseUsersOutput);
