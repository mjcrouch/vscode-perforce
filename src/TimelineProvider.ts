import * as vscode from "vscode";
import * as p4 from "./api/PerforceApi";
import { isDepotUri, getDepotPathFromDepotUri } from "./PerforceUri";

type FileCache = {
    file: vscode.Uri;
    filelog: p4.FileLogItem[];
    items: vscode.TimelineItem[];
    isFullSet: boolean;
};

class PerforceTimelineProvider implements vscode.TimelineProvider {
    private _cached = new Map<string, FileCache>();

    getCachedItems(uri: vscode.Uri, isInitialCall: boolean) {
        const underlying = isDepotUri(uri) ? getDepotPathFromDepotUri(uri) : uri.fsPath;
        const cached = this._cached.get(underlying);
        if (!isInitialCall && !cached?.isFullSet) {
            // need more than we already have
            return undefined;
        }
        return cached;
    }

    setCachedItems(
        uri: vscode.Uri,
        filelog: p4.FileLogItem[],
        items: vscode.TimelineItem[],
        isFullSet: boolean
    ) {
        const underlying = isDepotUri(uri) ? getDepotPathFromDepotUri(uri) : uri.fsPath;
        this._cached.set(underlying, { file: uri, filelog, items, isFullSet });
    }

    async getHistoryAndItems(uri: vscode.Uri, max?: number) {
        const filelog = await p4.getFileHistory(uri, {
            file: uri,
            followBranches: true,
            max,
        });
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

        this.setCachedItems(uri, filelog, items, max === undefined);

        return items;
    }

    onDidChange?: vscode.Event<vscode.TimelineChangeEvent | undefined> | undefined;
    id: string = "perforce";
    label: string = "Perforce file revisions";
    async provideTimeline(
        uri: vscode.Uri,
        options: vscode.TimelineOptions
    ): Promise<vscode.Timeline> {
        // if the limit is a number and there's no cursor,
        // this is the initial call for the timeline provider used when opening the file.
        // Just get the requested limit to prevent excessive resource usage
        const max =
            typeof options.limit === "number" && options.cursor === undefined
                ? options.limit
                : undefined;
        const isInitialCall = max !== undefined;

        const cached = this.getCachedItems(uri, isInitialCall);
        const items = cached?.items ?? (await this.getHistoryAndItems(uri, max));

        return {
            items,
            paging: { cursor: isInitialCall ? "yes" : undefined },
        };
    }
}

export function registerTimeline() {
    vscode.workspace.registerTimelineProvider(
        ["file", "perforce"],
        new PerforceTimelineProvider()
    );
}
