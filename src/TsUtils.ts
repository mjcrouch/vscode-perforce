/**
 * Predicate used for filtering out undefined or null values from an array,
 * and resulting in an array of type T
 * @param obj a single element
 * @returns the truthiness of the value, and narrows the type to T
 */
export function isTruthy<T>(obj: T | undefined | null | void): obj is T {
    return !!obj;
}

export function parseDate(dateString: string) {
    // example: 2020/02/15 18:48:43
    // or: 2020/02/15
    const matches = /(\d{4})\/(\d{2})\/(\d{2})(?: (\d{2}):(\d{2}):(\d{2}))?/.exec(
        dateString.trim()
    );

    if (matches) {
        const [, year, month, day, hours, minutes, seconds] = matches;

        const hasTime = hours && minutes && seconds;

        return new Date(
            parseInt(year),
            parseInt(month) - 1,
            parseInt(day),
            hasTime ? parseInt(hours) : undefined,
            hasTime ? parseInt(minutes) : undefined,
            hasTime ? parseInt(seconds) : undefined
        );
    }
}

export function pluralise(
    num: number,
    word: string,
    limit?: number,
    fullPlural?: string
) {
    const isLimit = num === limit;
    const pluralWord = fullPlural || word + "s";
    const pluralised = num === 1 && !isLimit ? word : pluralWord;
    return num + (isLimit ? "+ " : " ") + pluralised;
}

export function isPositiveOrZero(str: string) {
    const num = parseInt(str);
    return !isNaN(num) && num >= 0;
}

export function dedupe<T, K extends keyof T>(items: T[], key: K) {
    const done = new Set<T[K]>();
    return items.filter((i) => (done.has(i[key]) ? false : done.add(i[key])));
}

export function addUniqueKeysToSet<T, K extends keyof T>(
    current: Set<T[K]>,
    items: T[],
    key: K
) {
    return items.filter((i) => (current.has(i[key]) ? false : current.add(i[key])));
}
