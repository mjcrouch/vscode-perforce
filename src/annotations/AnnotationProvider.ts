import * as vscode from "vscode";
import * as p4 from "../api/PerforceApi";

import { isTruthy, dedupe, addUniqueKeysToSet, pluralise } from "../TsUtils";
import * as PerforceUri from "../PerforceUri";
import * as md from "./MarkdownGenerator";
import * as ColumnFormatter from "./ColumnFormatter";
import { Display } from "../Display";
import { configAccessor } from "../ConfigService";

const nbsp = "\xa0";

type DecoratedChange = {
    chnum: string;
    decoration: vscode.DecorationOptions;
};

const normalDecoration = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    before: {
        margin: "0 1.75em 0 0",
    },
});

const highlightedDecoration = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: new vscode.ThemeColor("perforce.lineHighlightBackgroundColor"),
    overviewRulerColor: new vscode.ThemeColor("perforce.lineHighlightOverviewRulerColor"),
    overviewRulerLane: vscode.OverviewRulerLane.Left,
});

type LogInfo = {
    log: p4.FileLogItem;
    prev?: p4.FileLogItem;
    index: number;
    ageRating: number;
};

export class AnnotationProvider {
    private static _annotationsByUri = new Map<vscode.Uri, AnnotationProvider>();
    private static _onWillLoadEditor = new vscode.EventEmitter<vscode.Uri>();
    public static get onWillLoadEditor() {
        return this._onWillLoadEditor.event;
    }

    private _subscriptions: vscode.Disposable[];
    private _editor: vscode.TextEditor | undefined;
    private _p4Uri: vscode.Uri;
    private _decorationsByChnum: DecoratedChange[];

    private constructor(
        private _doc: vscode.Uri,
        private _annotations: (p4.Annotation | undefined)[],
        private _decorations: vscode.DecorationOptions[]
    ) {
        this._p4Uri = PerforceUri.fromUri(_doc);
        this._subscriptions = [];
        this._decorationsByChnum = this.mapToChnums();

        this._subscriptions.push(
            vscode.window.onDidChangeActiveTextEditor(this.onEditorChanged.bind(this))
        );

        this._subscriptions.push(
            vscode.window.onDidChangeTextEditorSelection(
                this.onSelectionChanged.bind(this)
            )
        );

        this._subscriptions.push(
            vscode.workspace.onDidCloseTextDocument(
                this.checkStillOpen.bind(this),
                this._subscriptions
            )
        );

        this.loadEditor();
    }

    private mapToChnums(): DecoratedChange[] {
        return this._annotations
            .map((ann, i) => {
                return ann?.revisionOrChnum
                    ? {
                          chnum: ann.revisionOrChnum,
                          decoration: this._decorations[i],
                      }
                    : undefined;
            })
            .filter(isTruthy);
    }

    private async getOpenFileRangesIfSameFile() {
        try {
            const isSame = await Display.isSameAsOpenFile(this._doc);
            return isSame ? vscode.window.activeTextEditor?.visibleRanges : undefined;
        } catch {}
    }

    private async loadEditor() {
        AnnotationProvider._onWillLoadEditor.fire(this._p4Uri);
        const ranges = await this.getOpenFileRangesIfSameFile();
        this._editor = await vscode.window.showTextDocument(this._p4Uri, {
            label: "hello",
            description: "hello",
        } as vscode.TextDocumentShowOptions);

        if (ranges) {
            this._editor.revealRange(ranges[0]);
        }

        this.applyBaseDecorations();
        // don't apply highlights until a line is selected
    }

    private applyBaseDecorations() {
        if (!this._editor) {
            return;
        }
        this._editor.setDecorations(normalDecoration, this._decorations);
    }

    private applyHighlightDecorations() {
        if (!this._editor) {
            return;
        }
        const line = this._editor.selection.start.line;
        const ann = this._annotations[line];
        const chnum = ann?.revisionOrChnum;

        const highlighted = this._decorationsByChnum
            .filter((dec) => dec.chnum === chnum)
            .map((dec) => dec.decoration.range);

        this._editor.setDecorations(highlightedDecoration, highlighted);
    }

    private clearDecorations() {
        this._editor?.setDecorations(normalDecoration, []);
        this._editor?.setDecorations(highlightedDecoration, []);
    }

    private onSelectionChanged(event: vscode.TextEditorSelectionChangeEvent) {
        if (this._editor && event.textEditor === this._editor) {
            this.applyHighlightDecorations();
        }
    }

    private onEditorChanged() {
        this.checkStillOpen();
        if (!vscode.window.activeTextEditor?.document) {
            return;
        }
        if (vscode.window.activeTextEditor?.document === this._editor?.document) {
            // this bit is weird - the same document may be opened in a new editor.
            // but the static map should ensure we only have one annotation provider per file
            this._editor = vscode.window.activeTextEditor;
            this.applyBaseDecorations();
            this.applyHighlightDecorations();
        }
    }

    private checkStillOpen() {
        if (
            this._editor &&
            !vscode.workspace.textDocuments.includes(this._editor.document)
        ) {
            Display.channel.appendLine("Document closed: " + this._editor.document.uri);
            this.dispose();
        }
    }

    dispose() {
        this.clearDecorations();
        // TODO bit ugly for the class to know about the static map
        if (AnnotationProvider._annotationsByUri.get(this._doc) === this) {
            AnnotationProvider._annotationsByUri.delete(this._doc);
        }
        this._decorationsByChnum = [];
        this._subscriptions.forEach((d) => d.dispose());
    }

    static getSecondaryIntegrations(log: p4.FileLogItem[]) {
        return log.flatMap((log) => {
            const froms = log.integrations.filter(
                (i) => i.direction === p4.Direction.FROM
            );
            if (froms.length > 1) {
                return froms.filter((i) => i.operation === "copy");
            }
            return [];
        });
    }

    /**
     * Recursively expands file logs to get information about changes not in the original filelog ouput
     */
    static async expandLogs(
        underlying: vscode.Uri,
        log: p4.FileLogItem[],
        doneFiles: Set<string>
    ): Promise<p4.FileLogItem[][]> {
        const needsMore = AnnotationProvider.getSecondaryIntegrations(log);

        const newFiles = addUniqueKeysToSet(doneFiles, needsMore, "file");

        if (newFiles.length > 0) {
            const promises = newFiles.map((int) =>
                p4.getFileHistory(underlying, { file: int.file, followBranches: true })
            );
            const newLogs = await Promise.all(promises);
            const expandedPromises = newLogs.map((log) =>
                this.expandLogs(underlying, log, doneFiles).catch((err) =>
                    Display.channel.appendLine(err)
                )
            );
            const expanded = (await Promise.all(expandedPromises)).filter(isTruthy);
            return newLogs.concat(...expanded);
        } else {
            return [];
        }
    }

    static findLogInfoForChange(
        change: string,
        logs: p4.FileLogItem[][],
        index: number,
        totalRevisions: number
    ): LogInfo | undefined {
        for (const log of logs) {
            const found = log.findIndex((l) => l.chnum === change);
            if (found >= 0) {
                const ageStep = 1 / Math.min(Math.max(1, totalRevisions), 10);
                const ageRating = Math.max(1 - ageStep * index, 0);
                return {
                    log: log[found],
                    prev: log[found + 1],
                    index,
                    ageRating,
                };
            }
        }
    }

    static toMapByChnum(
        annotations: p4.Annotation[],
        logs: p4.FileLogItem[][]
    ): Map<string, LogInfo> {
        const ret = new Map<string, LogInfo>();

        const required = dedupe(annotations, "revisionOrChnum")
            .map((a) => a.revisionOrChnum)
            .sort((a, b) => parseInt(b) - parseInt(a)); // sorted newest to oldest for heatmap
        const totalRevisions = required.length;

        const notFound: string[] = [];
        required.forEach((change, index) => {
            const found = this.findLogInfoForChange(change, logs, index, totalRevisions);
            if (found) {
                ret.set(change, found);
            } else {
                notFound.push(change);
            }
        });

        if (notFound.length > 0) {
            Display.showImportantError(
                "Error during annotation - could not find change information for " +
                    pluralise(notFound.length, "change") +
                    ": " +
                    notFound.join(", ")
            );
        }

        return ret;
    }

    static async annotate(uri: vscode.Uri) {
        const existing = this._annotationsByUri.get(uri);
        if (existing) {
            // TODO - this gets rid of the existing one and gets the new perforce details instead
            // is this actually useful, or should we just return the existing one?
            existing.dispose();
        }

        const followBranches = configAccessor.annotateFollowBranches;

        const underlying = PerforceUri.getUsableWorkspace(uri) ?? uri;

        const annotationsPromise = p4.annotate(underlying, {
            file: uri,
            outputChangelist: true,
            followBranches,
        });

        const logPromise = p4.getFileHistory(underlying, { file: uri, followBranches });

        const [annotations, log] = await Promise.all([annotationsPromise, logPromise]);

        const expanded = followBranches
            ? await this.expandLogs(underlying, log, new Set<string>())
            : [];
        const allLogs = [log, ...expanded];
        const logsByChnum = this.toMapByChnum(annotations.filter(isTruthy), allLogs);

        const decorations = getDecorations(underlying, annotations, log[0], logsByChnum);

        // try to use the depot URI to open the document, so that we can perform revision actions on it
        if (!PerforceUri.getRevOrAtLabel(uri) && !PerforceUri.isDepotUri(uri) && log[0]) {
            uri = PerforceUri.fromDepotPath(uri, log[0].file, log[0].revision);
        }

        const provider = new AnnotationProvider(uri, annotations, decorations);
        this._annotationsByUri.set(uri, provider);

        return provider;
    }
}

function makeHoverMessage(
    underlying: vscode.Uri,
    change: p4.FileLogItem,
    latestChange: p4.FileLogItem,
    prevChange?: p4.FileLogItem
): vscode.MarkdownString {
    const links = md.makeAllLinks(underlying, change, latestChange, prevChange);

    const markdown = new vscode.MarkdownString(
        md.makeUserAndDateSummary(underlying, change) +
            "\n\n" +
            links +
            "\n\n" +
            md.convertToMarkdown(change.description),
        true
    );
    markdown.isTrusted = true;

    return markdown;
}

function makeDecorationForChange(
    ageRating: number,
    isTop: boolean,
    summaryText: string,
    hoverMessage: vscode.MarkdownString,
    foregroundColor: vscode.ThemeColor,
    backgroundColor: vscode.ThemeColor,
    columnWidth: number
): DecorationWithoutRange {
    const alpha = ageRating;
    const color = `rgba(246, 106, 10, ${alpha})`;

    const overline = isTop ? "overline solid rgba(0, 0, 0, 0.2)" : undefined;

    // this is weird, but it works
    const before: vscode.ThemableDecorationRenderOptions &
        vscode.ThemableDecorationAttachmentRenderOptions = {
        contentText: nbsp + summaryText,
        color: foregroundColor,
        width: columnWidth + 2 + "ch",
        backgroundColor,
        border: "solid " + color,
        textDecoration: overline,
        borderWidth: "0px 2px 0px 0px",
    };
    const renderOptions: vscode.DecorationInstanceRenderOptions = { before };

    return {
        hoverMessage,
        renderOptions,
    };
}

type DecorationWithoutRange = Omit<vscode.DecorationOptions, "range">;

type ChangeDecoration = {
    // decoration for first line of an annotation
    top: DecorationWithoutRange;
    // decoration for subsequent lines
    body: DecorationWithoutRange;
};

function makeDecorationsByChnum(
    underlying: vscode.Uri,
    latestChange: p4.FileLogItem,
    logsByChnum: Map<string, LogInfo>
): Map<string, ChangeDecoration> {
    const backgroundColor = new vscode.ThemeColor("perforce.gutterBackgroundColor");
    const foregroundColor = new vscode.ThemeColor("perforce.gutterForegroundColor");

    const columnOptions = ColumnFormatter.parseColumns(
        vscode.workspace
            .getConfiguration("perforce")
            .get<string[]>("annotate.gutterColumns", ["{#}revision|3"])
    );

    const columnWidth = ColumnFormatter.calculateTotalWidth(columnOptions);

    const ret = new Map<string, ChangeDecoration>();
    logsByChnum.forEach((log) => {
        const change = log.log;
        const prevChange = log.prev;
        const summary = ColumnFormatter.makeSummaryText(
            change,
            latestChange,
            columnOptions
        );
        const hoverMessage = makeHoverMessage(
            underlying,
            change,
            latestChange,
            prevChange
        );
        const top = makeDecorationForChange(
            log.ageRating,
            true,
            summary,
            hoverMessage,
            foregroundColor,
            backgroundColor,
            columnWidth
        );
        const body = makeDecorationForChange(
            log.ageRating,
            false,
            nbsp,
            hoverMessage,
            foregroundColor,
            backgroundColor,
            columnWidth
        );
        ret.set(change.chnum, { top, body });
    });

    return ret;
}

function getDecorations(
    underlying: vscode.Uri,
    annotations: (p4.Annotation | undefined)[],
    latestChange: p4.FileLogItem,
    logsByChnum: Map<string, LogInfo>
): vscode.DecorationOptions[] {
    const decorations = makeDecorationsByChnum(underlying, latestChange, logsByChnum);
    return annotations
        .map((a, i) => {
            if (!a || !a?.revisionOrChnum) {
                return;
            }

            const changeDecoration = decorations.get(a.revisionOrChnum);

            if (!changeDecoration) {
                return;
            }

            const usePrevious =
                i > 0 && a.revisionOrChnum === annotations[i - 1]?.revisionOrChnum;
            const decoration = usePrevious ? changeDecoration.body : changeDecoration.top;

            return {
                range: new vscode.Range(i, 0, i, 0),
                ...decoration,
            };
        })
        .filter(isTruthy);
}

export async function annotate(uri: vscode.Uri) {
    return AnnotationProvider.annotate(uri);
}
