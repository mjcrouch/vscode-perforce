export type FixedJob = { id: string; description: string[] };

export type ChangeInfo = {
    chnum: string;
    description: string;
    date: string;
    user: string;
    client: string;
    status: string;
};

export type ChangeSpec = {
    description?: string;
    files?: ChangeSpecFile[];
    change?: string;
    rawFields: ChangeFieldRaw[];
};

export type ChangeFieldRaw = {
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

export type PerforceFileSpec = {
    /** The filesystem path - without escaping special characters */
    fsPath: string;
    /** Optional suffix, e.g. #1, @=2 */
    suffix?: string;
};

export type PerforceFile = PerforceFileSpec | string;

export function isPerforceFileSpec(obj: any): obj is PerforceFileSpec {
    return obj && obj.fsPath;
}
