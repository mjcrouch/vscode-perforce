import * as vscode from "vscode";
import * as p4 from "./api/PerforceApi";

import TimeAgo from "javascript-time-ago";
import * as en from "javascript-time-ago/locale/en";
import { isTruthy } from "./api/CommandUtils";
import { Utils } from "./Utils";
import * as DiffProvider from "./DiffProvider";
import { Display } from "./Display";

TimeAgo.addLocale(en);

const nbsp = "\xa0";

const timeAgo = new TimeAgo("en-US");

type ColumnOption = {
    name: ValidColumn;
    length: number;
    padLeft: boolean;
    truncateRight: boolean;
    prefix?: string;
};

type ValidColumn = "revision" | "chnum" | "user" | "client" | "description" | "timeAgo";

//example:
// truncate chnum to 4, keeping the rightmost chars, prefix with `change #`, align right
// ->{change #}...chnum|4
const columnRegex = /^(->)?(?:\{(.*?)\})?(\.{3})?(revision|chnum|user|client|description|timeAgo)\|(\d+)$/;

function parseColumn(item: string): ColumnOption | undefined {
    const match = columnRegex.exec(item);
    if (match) {
        const [, padLeft, prefix, truncateRight, name, lenStr] = match;
        return {
            name: name as ValidColumn,
            length: parseInt(lenStr),
            padLeft: !!padLeft,
            truncateRight: !!truncateRight,
            prefix
        };
    } else {
        Display.showImportantError(
            item + " is not a valid column format. Skipping this column"
        );
    }
}

type ColumnBehavior = {
    value: (change: p4.FileLogItem, latestChange: p4.FileLogItem) => string;
};

type ColumnBehaviors = Record<ValidColumn, ColumnBehavior>;

const behaviors: ColumnBehaviors = {
    revision: {
        value: (change, latestChange) =>
            change.file === latestChange.file ? change.revision : "ᛦ" + change.revision
    },
    chnum: {
        value: change => change.chnum
    },
    user: { value: change => change.user },
    client: { value: change => change.client },
    description: {
        value: change => replaceWhitespace(change.description)
    },
    timeAgo: {
        value: change => (change.date ? timeAgo.format(change.date) : "Unknown")
    }
};

function calculateTotalWidth(options: ColumnOption[]) {
    const totalWidth = options.reduce(
        (all, cur) =>
            // + 1 to include the space
            all + cur.length + (cur.prefix?.length ?? 0) + 1,
        -1
    ); // start on -1 to account for the extra space
    return Math.max(0, totalWidth);
}

function truncate(
    str: string,
    prefix: string,
    maxLength: number,
    truncateRight?: boolean
): string {
    if (str.length > maxLength) {
        return truncateRight
            ? prefix + "…" + str.slice(-(maxLength - 1))
            : prefix + str.slice(0, maxLength - 1) + "…";
    }
    return prefix + str;
}

function truncateOrPad(
    str: string,
    prefix: string,
    maxLength: number,
    padLeft?: boolean,
    truncateRight?: boolean
): string {
    const truncated = truncate(str, prefix, maxLength, truncateRight);
    const padSpaces = nbsp.repeat(Math.max(0, maxLength - truncated.length));
    return padLeft ? padSpaces + truncated : truncated + padSpaces;
}

function doubleUpNewlines(str: string) {
    return str.replace(/\n+/g, "\n\n");
}

function replaceWhitespace(str: string) {
    return str.replace(/\s/g, nbsp);
}

function makeSummaryText(
    change: p4.FileLogItem,
    latestChange: p4.FileLogItem,
    columnOptions: ColumnOption[]
) {
    const formatted = columnOptions.reduceRight<string>((all, col) => {
        const fullValue = replaceWhitespace(
            behaviors[col.name].value(change, latestChange)
        );
        const availableWhitespace = /^([\s\xa0]*)/.exec(all);
        const wsLen = availableWhitespace?.[1] ? availableWhitespace[1].length : 0;
        const truncated = truncateOrPad(
            fullValue,
            col.prefix ?? "",
            col.length + wsLen,
            col.padLeft,
            col.truncateRight
        );
        return truncated + nbsp + all.slice(wsLen);
    }, "");
    return formatted;
}

function makeUserAndDateSummary(change: p4.FileLogItem) {
    const dateOptions: Intl.DateTimeFormatOptions = {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "numeric"
    };
    return (
        change.file +
        "#" +
        change.revision +
        "\n\n" +
        "**Change `#" +
        change.chnum +
        "`** by **`" +
        change.user +
        "`** on `" +
        (change.date?.toLocaleString(vscode.env.language, dateOptions) ?? "???") +
        "`"
    );
}

function makeSwarmHostURL(change: p4.FileLogItem, swarmHost: string) {
    return swarmHost + "/changes/" + change.chnum;
}

function makeCommandURI(command: string, ...args: any[]) {
    const encoded = encodeURIComponent(JSON.stringify(args));
    return "command:" + command + "?" + encoded;
}

function makeDiffURI(prevChange: p4.FileLogItem, change: p4.FileLogItem) {
    const args = [makePerforceURI(prevChange), makePerforceURI(change)];
    return (
        makeCommandURI("perforce.diffFiles", ...args) +
        ' "' +
        DiffProvider.diffTitleForDepotPaths(
            prevChange.file,
            prevChange.revision,
            change.file,
            change.revision
        ) +
        '"'
    );
}

function makePerforceURI(change: p4.FileLogItem) {
    const baseUri = vscode.Uri.parse("perforce:" + change.file).with({
        fragment: change.revision
    });
    return Utils.makePerforceDocUri(baseUri, "print", "-q", { depot: true });
}

function makeAnnotateURI(change: p4.FileLogItem) {
    const args = makePerforceURI(change).toString();
    return makeCommandURI("perforce.annotate", args);
}

function makeMarkdownLink(text: string, link: string) {
    return "\\[[" + text + "](" + link + ")\\]";
}

function makeHoverMessage(
    change: p4.FileLogItem,
    latestChange: p4.FileLogItem,
    prevChange?: p4.FileLogItem,
    swarmHost?: string
): vscode.MarkdownString {
    const diffLink = prevChange
        ? makeMarkdownLink("Diff Previous", makeDiffURI(prevChange, change))
        : undefined;
    const diffLatestLink =
        change !== latestChange
            ? makeMarkdownLink("Diff Latest", makeDiffURI(change, latestChange))
            : undefined;
    const annotateLink =
        change !== latestChange
            ? makeMarkdownLink("Annotate", makeAnnotateURI(change))
            : undefined;
    const swarmLink = swarmHost
        ? makeMarkdownLink("Open in Swarm", makeSwarmHostURL(change, swarmHost))
        : undefined;

    const links = [swarmLink, diffLink, diffLatestLink, annotateLink]
        .filter(isTruthy)
        .join(" ");

    const md = new vscode.MarkdownString(
        makeUserAndDateSummary(change) +
            "\n\n" +
            links +
            "\n\n" +
            doubleUpNewlines(change.description)
    );
    md.isTrusted = true;

    return md;
}

function getDecorations(
    swarmHost: string | undefined,
    annotations: (p4.Annotation | undefined)[],
    log: p4.FileLogItem[]
): vscode.DecorationOptions[] {
    //const decorateColors: string[] = ["rgb(153, 153, 153)", "rgb(103, 103, 103)"];
    const backgroundColor = new vscode.ThemeColor("perforce.gutterBackgroundColor");
    const foregroundColor = new vscode.ThemeColor("perforce.gutterForegroundColor");
    let lastNum = "";

    const latestChange = log[0];

    const columnOptions: ColumnOption[] = vscode.workspace
        .getConfiguration("perforce")
        .get<string[]>("annotate.gutterColumns", ["{#}revision|3"])
        .map(parseColumn)
        .filter(isTruthy)
        .filter(col => col.length && col.length >= 0);

    const columnWidth = calculateTotalWidth(columnOptions);

    return annotations
        .map((a, i) => {
            const usePrevious =
                i > 0 && a?.revisionOrChnum === annotations[i - 1]?.revisionOrChnum;
            const annotation = usePrevious ? annotations[i - 1] : a;

            if (!annotation) {
                return;
            }

            const changeIndex = log.findIndex(
                l => l.chnum === annotation.revisionOrChnum
            );
            const change = changeIndex >= 0 ? log[changeIndex] : undefined;
            const prevChange = log[changeIndex + 1];

            const summary = usePrevious
                ? nbsp
                : change
                ? makeSummaryText(change, latestChange, columnOptions)
                : "Unknown!";

            const num = annotation.revisionOrChnum;
            const hoverMessage = change
                ? makeHoverMessage(change, latestChange, prevChange, swarmHost)
                : num;

            if (num !== lastNum) {
                lastNum = num;
            }

            const before: vscode.ThemableDecorationAttachmentRenderOptions = {
                contentText: nbsp + summary,
                color: foregroundColor,
                width: columnWidth + 2 + "ch",
                backgroundColor
            };
            const renderOptions: vscode.DecorationInstanceRenderOptions = { before };

            return {
                range: new vscode.Range(i, 0, i, 0),
                hoverMessage,
                renderOptions
            };
        })
        .filter(isTruthy);
}

export async function annotate(uri: vscode.Uri, swarmHost?: string) {
    // TODO don't annotate an already annotated file!

    const annotationsPromise = p4.annotate(uri, {
        file: uri,
        outputChangelist: true,
        followBranches: true
    });

    const logPromise = p4.getFileHistory(uri, { file: uri, followBranches: true });

    const [annotations, log] = await Promise.all([annotationsPromise, logPromise]);

    const decorations = getDecorations(swarmHost, annotations, log);
    printAndDecorate(uri, decorations);
}

async function printAndDecorate(
    uri: vscode.Uri,
    decorations: vscode.DecorationOptions[]
) {
    const decorationType = vscode.window.createTextEditorDecorationType({
        isWholeLine: true,
        before: {
            margin: "0 1.75em 0 0"
        }
    });

    const p4Uri = Utils.makePerforceDocUri(uri, "print", "-q");
    const editor = await vscode.window.showTextDocument(p4Uri);
    editor.setDecorations(decorationType, decorations);
}
