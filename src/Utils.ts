import { Event, workspace, Uri } from "vscode";

import * as Fs from "fs";
import * as Path from "path";
import { execSync } from "child_process";
import { Display } from "./Display";

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
            path = getResolvedPath(path) ?? path;
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
            if (!path) {
                return path;
            }
            let respath = path;
            try {
                const isWindows = process.platform === "win32";
                if (isWindows) {
                    // Handle SYMLINKD and JUNCTION on Windows platform
                    if (isVolumeLabel(path)) {
                        return path;
                    }
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
                } else {
                    // Handle symbolic links on Linux/Unix platforms
                    const stats = Fs.lstatSync(path);
                    if (stats.isSymbolicLink()) {
                        respath = Fs.readlinkSync(path);
                        if (!Path.isAbsolute(respath)) {
                            respath = Path.resolve(Path.dirname(path), respath);
                        }
                    }
                }
            } catch (error) {}
            return respath;
        } catch (error) {
            console.error("Error resolving symbolic link or junction: ", error);
            return path;
        }
    }

    interface CacheEntry {
        result: string;
        timestamp: number;
    }
    const linkCache = new Map<string, CacheEntry>();
    const LINK_CACHE_VALIDITY = -1; // never out of date
    const LINK_CACHE_MAX_SIZE = 1000;

    function isLinkCacheValid(entry: CacheEntry) {
        if (LINK_CACHE_VALIDITY < 0) {
            return true;
        }
        return Date.now() - entry.timestamp < LINK_CACHE_VALIDITY;
    }

    function maintainLinkCache() {
        if (linkCache.size > LINK_CACHE_MAX_SIZE) {
            const oldSize = linkCache.size;
            const keys = Array.from(linkCache.keys()).sort((a, b) => {
                const entryA = linkCache.get(a);
                const entryB = linkCache.get(b);
                if (entryA && entryB) {
                    return entryA.timestamp - entryB.timestamp;
                }
                return 0;
            });
            const minRemoveCount = linkCache.size - LINK_CACHE_MAX_SIZE;
            for (let i = 0; i < linkCache.size; i++) {
                const entry = linkCache.get(keys[i]);
                if (i <= minRemoveCount || !entry || !isLinkCacheValid(entry)) {
                    linkCache.delete(keys[i]);
                }
            }
            Display.channel.appendLine(
                "Info: cache adjusted, oldSize=" + oldSize + ", newSize=" + linkCache.size
            );
        }
    }

    function parseAllLinks(path: string, forceRefresh = false) {
        try {
            const cacheEntry = linkCache.get(path);
            if (cacheEntry && isLinkCacheValid(cacheEntry) && !forceRefresh) {
                return cacheEntry.result;
            }

            const normalizedPath = Path.normalize(path);
            const parts = normalizedPath.split(Path.sep);

            let respath = "";
            for (let i = 0; i < parts.length; ++i) {
                if (i === 0) {
                    respath = parts[i];
                } else {
                    respath = Path.join(respath, parts[i]);
                }
                respath = parseLastLink(respath);
            }

            maintainLinkCache();
            linkCache.set(path, { result: respath, timestamp: Date.now() });

            // Display.channel.appendLine("Info: link parsed, cachesize=" + linkCache.size + ", path=" + path + ", respath=" + respath);

            return respath;
        } catch (error) {
            console.error("Error resolving symbolic link or junction: ", error);
            return path;
        }
    }

    export function getResolvedPath(path: string | undefined): string | undefined {
        if (!path || !workspace.getConfiguration("perforce").get("resolveLinks", false)) {
            return path;
        }
        return parseAllLinks(path);
    }

    export function getResolvedUri(uri: Uri | undefined): Uri | undefined {
        if (!uri || !workspace.getConfiguration("perforce").get("resolveLinks", false)) {
            return uri;
        }
        if (uri.scheme !== "file") {
            return uri;
        }
        const resolvedFsPath = parseAllLinks(uri.fsPath);
        return Uri.file(resolvedFsPath).with({
            query: uri.query,
            scheme: uri.scheme,
            fragment: uri.fragment,
            authority: uri.authority,
        });
    }
}
