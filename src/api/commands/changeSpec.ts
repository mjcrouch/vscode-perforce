import { pipe } from "@arrows/composition";
import {
    concatIfOutputIsDefined,
    flagMapper,
    makeSimpleCommand,
    asyncOuputHandler,
    splitIntoLines,
} from "../CommandUtils";
import { RawField, ChangeSpec } from "../CommonTypes";
import { getBasicField, parseSpecOutput } from "../SpecParser";

function mapToChangeFields(rawFields: RawField[]): ChangeSpec {
    return {
        change: getBasicField(rawFields, "Change")?.[0].trim(),
        description: getBasicField(rawFields, "Description")?.join("\n"),
        files: getBasicField(rawFields, "Files")?.map((file) => {
            // exmample:
            //   //depot/TestArea/doc3.txt       # add
            //   //depot/TestArea/My initial text document.txt   # edit
            //   //depot/TestArea/my next document.txt   # delete
            const endOfFileStr = file.indexOf("#");
            return {
                depotPath: file.slice(0, endOfFileStr).trim(),
                action: file.slice(endOfFileStr + 2),
            };
        }),
        rawFields,
    };
}

const parseChangeSpec = pipe(parseSpecOutput, mapToChangeFields);

export type ChangeSpecOptions = {
    existingChangelist?: string;
};

const changeFlags = flagMapper<ChangeSpecOptions>([], "existingChangelist", ["-o"], {
    lastArgIsFormattedArray: true,
});

const outputChange = makeSimpleCommand("change", changeFlags);

export const getChangeSpec = asyncOuputHandler(outputChange, parseChangeSpec);

const getChangeAsRawField = (spec: ChangeSpec) =>
    spec.change ? { name: "Change", value: [spec.change] } : undefined;

const getDescriptionAsRawField = (spec: ChangeSpec) =>
    spec.description
        ? { name: "Description", value: splitIntoLines(spec.description) }
        : undefined;

const getFilesAsRawField = (spec: ChangeSpec) =>
    spec.files
        ? {
              name: "Files",
              value: spec.files.map((file) => file.depotPath + "\t# " + file.action),
          }
        : undefined;

function getDefinedSpecFields(spec: ChangeSpec): RawField[] {
    return concatIfOutputIsDefined(
        getChangeAsRawField,
        getDescriptionAsRawField,
        getFilesAsRawField
    )(spec);
}

export type InputChangeSpecOptions = {
    spec: ChangeSpec;
};

export type CreatedChangelist = {
    rawOutput: string;
    chnum?: string;
};

function parseCreatedChangelist(createdStr: string): CreatedChangelist {
    const matches = /Change\s(\d+)\s/.exec(createdStr);
    return {
        rawOutput: createdStr,
        chnum: matches?.[1],
    };
}

const inputChange = makeSimpleCommand(
    "change",
    () => ["-i"],
    (options: InputChangeSpecOptions) => {
        return {
            input:
                getDefinedSpecFields(options.spec)
                    .concat(
                        options.spec.rawFields.filter(
                            (field) =>
                                !options.spec[
                                    field.name.toLowerCase() as keyof ChangeSpec
                                ]
                        )
                    )
                    .map((field) => field.name + ":\t" + field.value.join("\n\t"))
                    .join("\n\n") + "\n\n", // perforce doesn't like an empty raw field on the end without newlines
        };
    }
);

export const inputChangeSpec = asyncOuputHandler(inputChange, parseCreatedChangelist);
