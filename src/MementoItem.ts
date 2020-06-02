import * as vscode from "vscode";

// keys for workspace level mementos
export enum MementoKeys {
    SEARCH_STATUS = "changeSearch.statusFilter",
    SEARCH_USER = "changeSearch.userFilter",
    SEARCH_CLIENT = "changeSearch.clientFilter",
    SEARCH_FILES = "changeSearch.fileFilters",
    SEARCH_AUTO_REFRESH = "changeSearch.autoRefresh",
}

// keys for global mementos
export enum GlobalMementoKeys {
    SPEC_CHANGELIST_MAP = "changeMap",
    SPEC_JOB_MAP = "jobMap",
}

export class MementoItem<T> {
    constructor(private _key: string, private _memento: vscode.Memento) {}

    public async save(value?: T) {
        await this._memento.update(this._key, value);
    }

    public get value() {
        return this._memento.get<T>(this._key);
    }
}

export async function clearAllMementos(
    memento: vscode.Memento,
    globalMemento: vscode.Memento
) {
    await Promise.all(
        Object.values(MementoKeys).map((key) => memento.update(key, undefined))
    );
    await Promise.all(
        Object.values(GlobalMementoKeys).map((key) =>
            globalMemento.update(key, undefined)
        )
    );
}
