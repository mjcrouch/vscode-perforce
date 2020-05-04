export enum Status {
    ADD,
    ARCHIVE,
    BRANCH,
    DELETE,
    EDIT,
    IMPORT,
    INTEGRATE,
    LOCK,
    MOVE_ADD,
    MOVE_DELETE,
    PURGE,
    UNKNOWN,
}

export function operationCreatesFile(status: Status) {
    return [Status.ADD, Status.BRANCH, Status.MOVE_ADD].includes(status);
}

export function operationDeletesFile(status: Status) {
    return [Status.DELETE, Status.MOVE_DELETE].includes(status);
}

export function GetStatus(statusText: string): Status {
    switch (statusText.trim().toLowerCase()) {
        case "add":
            return Status.ADD;
        case "archive":
            return Status.ARCHIVE;
        case "branch":
            return Status.BRANCH;
        case "delete":
            return Status.DELETE;
        case "edit":
            return Status.EDIT;
        case "integrate":
            return Status.INTEGRATE;
        case "import":
            return Status.IMPORT;
        case "lock":
            return Status.LOCK;
        case "move/add":
            return Status.MOVE_ADD;
        case "move/delete":
            return Status.MOVE_DELETE;
        case "purge":
            return Status.PURGE;
        default:
            return Status.UNKNOWN;
    }
}

export function GetStatuses(statusText: string): Status[] {
    const result: Status[] = [];
    if (!statusText) {
        return result;
    }

    const statusStrings: string[] = statusText.split(",");
    for (let i = 0; i < statusStrings.length; i++) {
        result.push(GetStatus(statusStrings[i]));
    }

    return result;
}
