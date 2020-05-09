import * as vscode from "vscode";
import * as p4 from "./api/PerforceApi";
import { isDepotUri, getDepotPathFromDepotUri } from "./PerforceUri";

type FileCache = {
    file: vscode.Uri;
    filelog: p4.FileLogItem[];
    items: vscode.TimelineItem[];
};

class PerforceTimelineProvider implements vscode.TimelineProvider {
    private _cached = new Map<string, FileCache>();

    getCachedItems(uri: vscode.Uri) {
        const underlying = isDepotUri(uri) ? getDepotPathFromDepotUri(uri) : uri.fsPath;
        return this._cached.get(underlying);
    }

    setCachedItems(
        uri: vscode.Uri,
        filelog: p4.FileLogItem[],
        items: vscode.TimelineItem[]
    ) {
        const underlying = isDepotUri(uri) ? getDepotPathFromDepotUri(uri) : uri.fsPath;
        this._cached.set(underlying, { file: uri, filelog, items });
    }

    async getHistoryAndItems(uri: vscode.Uri) {
        const filelog = await p4.getFileHistory(uri, { file: uri, followBranches: true });
        const items = filelog.map<vscode.TimelineItem>((h) => {
            const isOldFile = h.file !== filelog[0].file;
            return {
                timestamp: h.date?.getTime() ?? 0,
                label:
                    (isOldFile ? "ᛦ" : "") +
                    h.revision +
                    ": " +
                    h.description.split("\n")[0].slice(0, 64),
                description: h.user,
                detail: h.file + "#" + h.revision + "\n--------\n\n" + h.description,
                id: h.chnum,
            };
        });

        this.setCachedItems(uri, filelog, items);

        return items;
    }

    onDidChange?: vscode.Event<vscode.TimelineChangeEvent | undefined> | undefined;
    id: string = "perforce";
    label: string = "Perforce file revisions";
    async provideTimeline(
        uri: vscode.Uri
        //options: vscode.TimelineOptions
    ): Promise<vscode.Timeline> {
        const cached = this.getCachedItems(uri);

        const items = cached?.items ?? (await this.getHistoryAndItems(uri));

        return {
            items,
        };
    }
}

export function registerTimeline() {
    vscode.workspace.registerTimelineProvider(
        ["file", "perforce"],
        new PerforceTimelineProvider()
    );
}
