import {
    flagMapper,
    makeSimpleCommand,
    splitIntoLines,
    asyncOuputHandler,
} from "../CommandUtils";
import { isTruthy } from "../../TsUtils";

export interface ClientsOptions {
    nameFilter?: string;
    max?: number;
}

const clientsFlags = flagMapper<ClientsOptions>([
    ["E", "nameFilter", { withoutSpace: true }],
    ["m", "max"],
]);

const clientsCommand = makeSimpleCommand("clients", clientsFlags);

export type ClientInfo = {
    client: string;
    date: string;
    root: string;
    description: string;
};

function parseClientLine(line: string) {
    const matches = /^Client (\S*) (\S*) root (.*) '(.*)'$/.exec(line);
    if (matches) {
        const [, client, date, root, description] = matches;
        return {
            client,
            date,
            root,
            description,
        };
    }
}

function parseClientsOutput(output: string) {
    const lines = splitIntoLines(output);
    return lines.map(parseClientLine).filter(isTruthy);
}

export const clients = asyncOuputHandler(clientsCommand, parseClientsOutput);
