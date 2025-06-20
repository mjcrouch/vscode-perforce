import * as vscode from "vscode";
import * as p4 from "./api/PerforceApi";
import { Display } from "./Display";
import * as Path from "path";

import { timeAgo, toReadableDateTime, toReadableDate } from "./DateFormatter";
import * as PerforceUri from "./PerforceUri";
import { configAccessor } from "./ConfigService";
import {
    AnnotationProvider,
    annotate,
    makeHoverMessage,
} from "./annotations/AnnotationProvider";

/**
 * Change information type definition
 */
export interface ChangeInfo {
    revision: string;
    change: string;
    user: string;
    date: Date;
    description: string;
}

/**
 * ChangelistLens feature manager
 * Provides changelist information display in code with hover details
 * Unlike AnnotationProvider, this only shows change information on the selected line
 */
export class ChangelistLens implements vscode.Disposable {
    private static _instance: ChangelistLens | undefined;
    private disposables: vscode.Disposable[] = [];
    private decorationType: vscode.TextEditorDecorationType;
    private currentSelectedLine: number = -1; // Track current selected line
    private annotations: (p4.Annotation | undefined)[] = []; // Store annotations for all lines
    private fileLogsMap: Map<string, p4.FileLogItem> = new Map(); // Store changelist info, key is changelist number

    /**
     * Get singleton instance
     */
    public static getInstance(): ChangelistLens {
        if (!this._instance) {
            this._instance = new ChangelistLens();
        }
        return this._instance;
    }

    /**
     * Constructor
     */
    private constructor() {
        // Create decoration type - only show changelist info at end of line, using theme colors
        this.decorationType = vscode.window.createTextEditorDecorationType({
            after: {
                margin: "0 0 0 10em",
                textDecoration: "none",
                // Use theme colors instead of hardcoded values
                color: new vscode.ThemeColor("perforce.changelistLensForeground"),
                border: "1px solid",
                borderColor: new vscode.ThemeColor("perforce.changelistLensBorder"),
            },
            rangeBehavior: vscode.DecorationRangeBehavior.ClosedOpen,
        });

        // Register event listeners
        this.disposables.push(
            vscode.window.onDidChangeActiveTextEditor(
                this.onDidChangeActiveTextEditor.bind(this),
                this
            ),
            vscode.workspace.onDidSaveTextDocument((document) =>
                this.onDidSaveTextDocument(document)
            ),
            // Add selection change event listener
            vscode.window.onDidChangeTextEditorSelection(
                this.onDidChangeTextEditorSelection.bind(this),
                this
            )
        );

        // Process current active editor immediately
        if (vscode.window.activeTextEditor) {
            this.onDidChangeActiveTextEditor(vscode.window.activeTextEditor);
        }
    }

    /**
     * Handle editor selection change event
     */
    private onDidChangeTextEditorSelection(
        event: vscode.TextEditorSelectionChangeEvent
    ): void {
        const editor = event.textEditor;
        if (!editor || editor.document.uri.scheme !== "file") {
            return;
        }

        // Get selected line
        const selection = editor.selection;
        const newSelectedLine = selection.active.line;

        // If selected line changed, update decorations
        if (this.currentSelectedLine !== newSelectedLine) {
            this.currentSelectedLine = newSelectedLine;
            this.updateDecorations(editor);
        }
    }

    /**
     * Handle editor change event
     */
    private onDidChangeActiveTextEditor(editor: vscode.TextEditor | undefined): void {
        if (!editor || editor.document.uri.scheme !== "file") {
            return;
        }

        // Clear previous data and get annotations for new file
        this.clearCache();

        // Set current selected line
        this.currentSelectedLine = editor.selection.active.line;

        // Get and apply decorations
        this.getAnnotationsForFile(editor.document.uri)
            .then(() => {
                this.updateDecorations(editor);
            })
            .catch((err) => {
                Display.channel.appendLine(
                    `[ChangelistLens] Error getting file annotations: ${err}`
                );
            });
    }

    /**
     * Handle document save event
     */
    private onDidSaveTextDocument(document: vscode.TextDocument): void {
        // Find editor for this document from all visible editors
        vscode.window.visibleTextEditors.forEach((editor) => {
            if (editor.document.uri.toString() === document.uri.toString()) {
                // Clear cache and get annotations again
                this.clearCache();
                this.getAnnotationsForFile(document.uri)
                    .then(() => {
                        this.updateDecorations(editor);
                    })
                    .catch((err) => {
                        Display.channel.appendLine(
                            `[ChangelistLens] Error getting file annotations: ${err}`
                        );
                    });
            }
        });
    }

    /**
     * Get file annotations
     */
    private async getAnnotationsForFile(uri: vscode.Uri): Promise<void> {
        try {
            // Removed log for better performance

            const underlying = PerforceUri.getUsableWorkspace(uri) ?? uri;
            const followBranches = configAccessor.annotateFollowBranches;

            // Get file annotations
            const annotationsPromise = p4.annotate(underlying, {
                file: uri,
                outputChangelist: true,
                outputUser: true,
                followBranches,
            });

            // Get file history
            const logPromise = p4.getFileHistory(underlying, {
                file: uri,
                followBranches,
            });

            const [annotations, logs] = await Promise.all([
                annotationsPromise,
                logPromise,
            ]);

            // Save annotations and changelist information
            this.annotations = annotations;

            // Store changelist information in Map for quick lookup
            logs.forEach((log) => {
                this.fileLogsMap.set(log.chnum, log);
            });

            // Removed log for better performance
        } catch (err) {
            Display.channel.appendLine(
                `[ChangelistLens] Error getting file annotations: ${err}`
            );
            throw err;
        }
    }

    /**
     * Update decorations for the specified editor
     * Only decorate the currently selected line
     */
    private updateDecorations(editor: vscode.TextEditor): void {
        // Clear all existing decorations
        editor.setDecorations(this.decorationType, []);

        // If no annotations or invalid selected line, return
        if (
            this.annotations.length === 0 ||
            this.currentSelectedLine < 0 ||
            this.currentSelectedLine >= this.annotations.length
        ) {
            return;
        }

        // Get annotation for current selected line
        const annotation = this.annotations[this.currentSelectedLine];
        if (!annotation || !annotation.revisionOrChnum) {
            return;
        }

        try {
            // Get changelist information
            const changeInfo = this.fileLogsMap.get(annotation.revisionOrChnum);
            if (!changeInfo) {
                return;
            }

            // Create decoration options
            const decoration = this.createDecorationForChange(annotation, changeInfo);
            if (decoration) {
                // Apply only to current selected line
                editor.setDecorations(this.decorationType, [decoration]);

                // Removed log for better performance
            }
        } catch (err) {
            Display.channel.appendLine(
                `[ChangelistLens] Error applying decorations: ${err}`
            );
        }
    }

    /**
     * Create decoration options for a change
     */
    private createDecorationForChange(
        annotation: p4.Annotation,
        change: p4.FileLogItem
    ): vscode.DecorationOptions | undefined {
        if (!annotation || !change) {
            return undefined;
        }

        try {
            // Create display text - changelist number, user and time
            const timeStr = timeAgo.format(change.date ?? new Date());

            const displayText = `CL: ${change.chnum} | ${change.user} | ${timeStr}`;

            // Get underlying URI for the file
            const underlying =
                PerforceUri.getUsableWorkspace(
                    vscode.window.activeTextEditor?.document.uri ?? vscode.Uri.file("")
                ) ?? vscode.window.activeTextEditor?.document.uri;

            if (!underlying) {
                return undefined;
            }

            // Use makeHoverMessage function from AnnotationProvider to create hover message
            const hoverMessage = makeHoverMessage(underlying, change, change);

            // Return decoration options - using theme colors consistent with constructor definition
            return {
                range: new vscode.Range(
                    this.currentSelectedLine,
                    Number.MAX_SAFE_INTEGER,
                    this.currentSelectedLine,
                    Number.MAX_SAFE_INTEGER
                ),
                renderOptions: {
                    after: {
                        contentText: displayText,
                        fontStyle: "italic",
                        // Use theme colors we defined instead of hardcoded colors
                        // This keeps consistency with the decorator definition in constructor
                    },
                },
                hoverMessage,
            };
        } catch (err) {
            Display.channel.appendLine(
                `[ChangelistLens] Error creating decoration: ${err}`
            );
            return undefined;
        }
    }

    /**
     * Clear cached annotations and changelist information
     */
    public clearCache(): void {
        this.annotations = [];
        this.fileLogsMap.clear();
        this.currentSelectedLine = -1;
    }

    /**
     * Release resources
     */
    public dispose(): void {
        this.disposables.forEach((d) => d.dispose());
        this.disposables = [];
        this.decorationType.dispose();
        this.clearCache();
        ChangelistLens._instance = undefined;
    }
}
