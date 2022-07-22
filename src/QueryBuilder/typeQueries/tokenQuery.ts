/*
 *  Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *  SPDX-License-Identifier: Apache-2.0
 */

import { InvalidSearchParameterError } from 'fhir-works-on-aws-interface';
import { CompiledSearchParam } from '../../FHIRSearchParametersRegistry';
import { TokenSearchValue } from '../../FhirQueryParser';
import tokenDataTypesMapJSON from '../../schema/tokenDataTypesMap.json';

// Fields that do not have `.keyword` suffix. This is only important if `useKeywordSubFields` is true
const FIELDS_WITHOUT_KEYWORD = ['id'];
const SUPPORTED_MODIFIERS: string[] = [];
const tokenDataTypesMap = tokenDataTypesMapJSON as any;

// type TokenDataType = 'Identifier' | 'code' | 'CodeableConcept' | 'id' | 'string' | 'boolean' | 'ContactPoint';

// eslint-disable-next-line import/prefer-default-export
export function tokenQuery(
    compiled: CompiledSearchParam,
    value: TokenSearchValue,
    useKeywordSubFields: boolean,
    modifier?: string,
): any {
    if (modifier && !SUPPORTED_MODIFIERS.includes(modifier)) {
        throw new InvalidSearchParameterError(`Unsupported token search modifier: ${modifier}`);
    }
    const { system, code, explicitNoSystemProperty } = value;
    const queries = [];
    const useKeywordSuffix = useKeywordSubFields && !FIELDS_WITHOUT_KEYWORD.includes(compiled.path);
    const keywordSuffix = useKeywordSuffix ? '.keyword' : '';

    // Token search params are used for many different field types.
    // We are doing a multi_match against all the applicable fields based on parsing StructureDefinitions
    // in the base fhir r4.
    // See: https://www.hl7.org/fhir/search.html#token
    // known limitations:
    // * doesn't handle base type inheritence
    // * doesn't handle expression where clauses
    // * doesn't handle expression as clauses
    // * doesn't handle types w/extensions
    // * doesn't support any fhir version besides fhir r4.0.1

    const dataTypeExists =
        compiled.resourceType in tokenDataTypesMap && compiled.path in tokenDataTypesMap[compiled.resourceType];
    const dataTypes: { code: string }[] = dataTypeExists ? tokenDataTypesMap[compiled.resourceType][compiled.path] : [];
    let hasIdentifierType: boolean = false;
    let hasCodeType: boolean = false;
    let hasCodeableConceptType: boolean = false;
    let hasIdType: boolean = false;
    let hasStringType: boolean = false;
    let hasBooleanType: boolean = false;
    let hasCodingType: boolean = false;
    let hasContactPointType: boolean = false;
    dataTypes.forEach((dataType) => {
        hasIdentifierType = hasIdentifierType || dataType.code === 'Identifier';
        hasCodeType = hasCodeType || dataType.code === 'code';
        hasCodeableConceptType = hasCodeableConceptType || dataType.code === 'CodeableConcept';
        hasIdType = hasIdType || dataType.code === 'id';
        hasStringType = hasStringType || dataType.code === 'string';
        hasBooleanType = hasBooleanType || dataType.code === 'boolean';
        hasCodingType = hasCodingType || dataType.code === 'Coding';
        hasContactPointType = hasContactPointType || dataType.code === 'ContactPoint';
    });

    if (system !== undefined) {
        const fields: string[] = [];

        if (dataTypeExists) {
            if (hasIdentifierType || hasCodingType) {
                fields.push(`${compiled.path}.system${keywordSuffix}`); // Coding, Identifier
            }

            if (hasCodeableConceptType) {
                fields.push(`${compiled.path}.coding.system${keywordSuffix}`); // CodeableConcept
            }

            if (fields.length === 0) {
                // fail-safe to fallback to search all system fields if we can't figure out the type
                fields.push(
                    `${compiled.path}.system${keywordSuffix}`, // Coding, Identifier
                    `${compiled.path}.coding.system${keywordSuffix}`, // CodeableConcept
                );
            }
        } else {
            fields.push(
                `${compiled.path}.system${keywordSuffix}`, // Coding, Identifier
                `${compiled.path}.coding.system${keywordSuffix}`, // CodeableConcept
            );
        }

        queries.push({
            multi_match: {
                fields,
                query: system,
                lenient: true,
            },
        });
    }

    if (code !== undefined) {
        // '.code', '.coding.code', 'value' came from the original input data, e.g. language in Patient resource:
        // ${keywordSuffix} came from ElasticSearch field mapping

        const fields: string[] = [];

        if (dataTypeExists) {
            if (hasCodingType) {
                fields.push(
                    `${compiled.path}.code${keywordSuffix}`, // Coding
                );
            }

            if (hasCodeableConceptType) {
                fields.push(
                    `${compiled.path}.coding.code${keywordSuffix}`, // CodeableConcept
                );
            }

            if (hasIdentifierType || hasContactPointType) {
                fields.push(
                    `${compiled.path}.value${keywordSuffix}`, // Identifier, ContactPoint
                );
            }

            if (hasCodeType || hasStringType || hasBooleanType || hasIdType) {
                // accommodate for boolean value when keywordSuffix is used, as .keyword field is not created for boolean value
                if (useKeywordSuffix && hasBooleanType) {
                    fields.push(`${compiled.path}`);
                }
                fields.push(
                    `${compiled.path}${keywordSuffix}`, // code, uri, string, boolean, id
                );
            }

            if (fields.length === 0) {
                // fail-safe to fallback to search all system fields if we can't figure out the type
                fields.push(
                    `${compiled.path}.code${keywordSuffix}`, // Coding
                    `${compiled.path}.coding.code${keywordSuffix}`, // CodeableConcept
                    `${compiled.path}.value${keywordSuffix}`, // Identifier, ContactPoint
                    `${compiled.path}${keywordSuffix}`, // code, uri, string, boolean, id
                );
            }
        } else {
            fields.push(
                `${compiled.path}.code${keywordSuffix}`, // Coding
                `${compiled.path}.coding.code${keywordSuffix}`, // CodeableConcept
                `${compiled.path}.value${keywordSuffix}`, // Identifier, ContactPoint
                `${compiled.path}${keywordSuffix}`, // code, uri, string, boolean, id
            );

            // accommodate for boolean value when keywordSuffix is used, as .keyword field is not created for boolean value
            if (useKeywordSuffix) {
                fields.push(`${compiled.path}`);
            }
        }

        queries.push({
            multi_match: {
                fields,
                query: code,
                lenient: true,
            },
        });
    }

    if (explicitNoSystemProperty) {
        queries.push({
            bool: {
                must_not: {
                    exists: {
                        field: `${compiled.path}.system`,
                    },
                },
            },
        });
    }

    if (queries.length === 1) {
        return queries[0];
    }

    return {
        bool: {
            must: queries,
        },
    };
}
