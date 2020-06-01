import * as vscode from "vscode";

export class MementoItem<T> {
    constructor(private _key: string, private _memento: vscode.Memento) {}

    public async save(value?: T) {
        await this._memento.update(this._key, value);
    }

    public get value() {
        return this._memento.get<T>(this._key);
    }
}
