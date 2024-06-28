import { Uri } from "vscode";

export type NoOpts = {};

export type FixedJob = { id: string; description: string[] };

export type ChangeInfo = {
    chnum: string;
    description: string[];
    date?: Date;
    user: string;
    client: string;
    isPending?: boolean;
};

export type ChangeSpec = {
    description?: string;
    files?: ChangeSpecFile[];
    change?: string;
    rawFields: RawField[];
};

export type RawField = {
    name: string;
    value: string[];
};

export type ChangeSpecFile = {
    depotPath: string;
    action: string;
};

export type FstatInfo = {
    depotFile: string;
    [key: string]: string;
};

export type PerforceFile = Uri | string;

export function isUri(obj: any): obj is Uri {
    return obj && obj.fsPath !== undefined && obj.scheme !== undefined;
}
