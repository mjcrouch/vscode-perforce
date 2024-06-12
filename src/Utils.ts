import { Event, workspace, Uri } from "vscode";

import * as Fs from "fs";
import * as Path from "path";
import { execSync } from "child_process";

export function mapEvent<I, O>(event: Event<I>, map: (i: I) => O): Event<O> {
    return (listener, thisArgs = null, disposables?) =>
        event((i) => listener.call(thisArgs, map(i)), null, disposables);
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Utils {
    // normalize function for turning windows paths into
    // something comparable before and after processing
    export function normalize(path: string): string {
        path = path.replace(/\\\\/g, "/");
        path = path.replace(/\\/g, "/");
        const matches = /([A-Z]):(.*)/.exec(path);
        if (matches) {
            path = `${matches[1].toLowerCase()}:${matches[2]}`;
        }
        return path;
    }

    // Use ASCII expansion for special characters
    export function expansePath(path: string): string {
        if (workspace.getConfiguration("perforce").get("realpath", false)) {
            if (Fs.existsSync(path)) {
                path = Fs.realpathSync(path);
            }
        }

        const fixup = path
            .replace(/%/g, "%25")
            .replace(/\*/g, "%2A")
            .replace(/#/g, "%23")
            .replace(/@/g, "%40");
        return fixup;
    }

    function isVolumeLabel(path: string): boolean {
        return /^[a-zA-Z]:\\?$/.test(path);
    }

    function parseLastLink(path: string): string {
        try {
            if (!path || isVolumeLabel(path)) {
                return path;
            }
            let respath = path;
            try {
                const dirname = Path.dirname(path);
                const basename = Path.basename(path);
                const output = execSync(
                    `dir "${dirname}" | findstr "${basename}" | findstr "<SYMLINKD> <JUNCTION>"`
                ).toString();
                if (output) {
                    const matches = new RegExp(/\[([^\]]+)\]/).exec(output);
                    if (matches && matches[1]) {
                        respath = matches[1];
                    }
                }
            } catch (error) {}
            return respath;
        } catch (error) {
            console.error("Error resolving symbolic link or junction: ", error);
            return path;
        }
    }

    function parseAllLinks(path: string): string {
        try {
            let realpath = Fs.realpathSync(path);
            realpath = Path.normalize(realpath);
            const parts = realpath.split("\\");

            let respath = "";
            for (let i = 0; i < parts.length; ++i) {
                if (i === 0) {
                    respath = parts[i];
                } else {
                    respath = Path.join(respath, parts[i]);
                }
                respath = parseLastLink(respath);
            }
            return respath;
        } catch (error) {
            console.error("Error resolving symbolic link or junction: ", error);
            return path;
        }
    }

    export function getResolvedPath(path: string | undefined): string | undefined {
        if (!path || !Fs.existsSync(path)) {
            return path;
        }
        return parseAllLinks(path);
    }

    export function getResolvedUri(uri: Uri | undefined): Uri | undefined {
        if (!uri || !Fs.existsSync(uri.fsPath)) {
            return uri;
        }
        return Uri.file(parseAllLinks(uri.fsPath));
    }
}
