// eslint.config.js
import js from "@eslint/js";
import stylistic from "@stylistic/eslint-plugin";
import globals from "globals";
import { dirname } from "path";
import tseslint from "typescript-eslint";
import { fileURLToPath } from "url";

export default [
    // Ignorés
    {
        "ignores": [
            "**/node_modules/**",
            "**/dist/**",
            "**/build/**",
            "**/coverage/**",
            "**/*.min.js",
        ],
    },

    // Base JS
    js.configs.recommended,

    // TypeScript (type-aware "raisonnable")
    ...tseslint.configs.recommendedTypeChecked,

    // Projet : options langage + style & règles perso
    {
        "name":            "project",
        "languageOptions": {
            "ecmaVersion":   "latest",
            "sourceType":    "module",
            "globals":       { ...globals.browser },
            "parserOptions": {
                "projectService":  true,
                "tsconfigRootDir": dirname( fileURLToPath( import.meta.url ) ),
            },
        },
        "rules": {
            "curly": [ "error", "all" ],

            "@typescript-eslint/restrict-template-expressions": "off",

            // Comparaisons explicites
            "@typescript-eslint/strict-boolean-expressions": [
                "error",
                {
                    "allowString":          true,
                    "allowNumber":          true,
                    "allowNullableObject":  true,
                    "allowNullableBoolean": true,
                    "allowNullableString":  true,
                    "allowNullableNumber":  true,
                    "allowAny":             true,
                },
            ],
            "@typescript-eslint/no-misused-promises": [
                "error",
                { "checksVoidReturn": { "attributes": false } },
            ],
            "@typescript-eslint/no-floating-promises": "error",
        },
    },

    // Désactiver l'analyse type-aware pour .js si présent
    {
        "files": [ "**/*.js", "**/*.cjs", "**/*.mjs" ],
        ...tseslint.configs.disableTypeChecked,
    },

    // Stylistic config
    {
        "name":    "stylisticConfig",
        "plugins": { "@stylistic": stylistic },
        "rules":   {

            // Stylistic rules enabled with default options
            "@stylistic/array-bracket-newline": "error",
            "@stylistic/array-bracket-spacing": [ "error", "always" ],
            "@stylistic/array-element-newline": [
                "error",
                {
                    "consistent": true,
                    "multiline":  true,
                },
            ],
            "@stylistic/arrow-parens":                   "error",
            "@stylistic/arrow-spacing":                  "error",
            "@stylistic/block-spacing":                  "error",
            "@stylistic/brace-style":                    "error",
            "@stylistic/comma-dangle":                   [ "error", "always-multiline" ],
            "@stylistic/comma-spacing":                  "error",
            "@stylistic/comma-style":                    "error",
            "@stylistic/computed-property-spacing":      "error",
            "@stylistic/curly-newline":                  [ "error", "always" ],
            "@stylistic/dot-location":                   "error",
            "@stylistic/eol-last":                       "error",
            "@stylistic/function-call-argument-newline": [ "error", "consistent" ],
            "@stylistic/function-call-spacing":          "error",
            "@stylistic/function-paren-newline":         "error",
            "@stylistic/generator-star-spacing":         "error",
            "@stylistic/implicit-arrow-linebreak":       "error",
            "@stylistic/indent":                         [
                "error",
                4,
                {
                    "SwitchCase":   1,
                    "ignoredNodes": [],
                },
            ],
            "@stylistic/indent-binary-ops":            "error",
            "@stylistic/key-spacing":                  [ "error", { "align": "value" } ],
            "@stylistic/keyword-spacing":              "error",
            "@stylistic/line-comment-position":        "off",
            "@stylistic/linebreak-style":              "error",
            "@stylistic/lines-around-comment":         [
                "error",
                {
                    "beforeLineComment": true,
                    "allowBlockStart":   true,
                    "allowBlockEnd":     true,
                    "allowClassStart":   true,
                    "allowClassEnd":     true,
                    "allowObjectStart":  true,
                    "allowObjectEnd":    true,
                    "allowArrayStart":   true,
                    "allowArrayEnd":     true,
                },
            ],
            "@stylistic/lines-between-class-members": "error",
            "@stylistic/max-len":                     "off",
            "@stylistic/max-statements-per-line":     [ "error", { "max": 1 } ],
            "@stylistic/member-delimiter-style":      "error",
            "@stylistic/multiline-comment-style":     "error",
            "@stylistic/multiline-ternary":           [ "error", "always-multiline" ],
            "@stylistic/new-parens":                  "error",
            "@stylistic/newline-per-chained-call":    "error",
            "@stylistic/no-confusing-arrow":          "error",
            "@stylistic/no-extra-parens":             [
                "error",
                "all",
                {
                    "nestedBinaryExpressions": false,
                    "returnAssign":            false,
                },
            ],
            "@stylistic/no-extra-semi":                    "error",
            "@stylistic/no-floating-decimal":              "error",
            "@stylistic/no-mixed-operators":               [ "error", { "groups": [ [ "&", "|", "^", "~", "<<", ">>", ">>>" ], [ "&&", "||" ] ] } ],
            "@stylistic/no-mixed-spaces-and-tabs":         "error",
            "@stylistic/no-multi-spaces":                  "off",
            "@stylistic/no-multiple-empty-lines":          "error",
            "@stylistic/no-tabs":                          "off",
            "@stylistic/no-trailing-spaces":               [ "error", { "ignoreComments": true } ],
            "@stylistic/no-whitespace-before-property":    "error",
            "@stylistic/nonblock-statement-body-position": "error",
            "@stylistic/object-curly-newline":             [ "error", { "multiline": true } ],
            "@stylistic/object-curly-spacing":             [ "error", "always" ],
            "@stylistic/object-property-newline":          "error",
            "@stylistic/one-var-declaration-per-line":     [ "error", "always" ],
            "@stylistic/operator-linebreak":               "error",
            "@stylistic/padded-blocks":                    [
                "error",
                {
                    "blocks":   "never",
                    "classes":  "always",
                    "switches": "never",
                },
                { "allowSingleLineBlocks": true },
            ],
            "@stylistic/quote-props":                     "error",
            "@stylistic/quotes":                          "error",
            "@stylistic/rest-spread-spacing":             "error",
            "@stylistic/semi":                            "error",
            "@stylistic/semi-spacing":                    "error",
            "@stylistic/semi-style":                      "error",
            "@stylistic/space-before-blocks":             "error",
            "@stylistic/space-before-function-paren":     [ "error", "never" ],
            "@stylistic/space-in-parens":                 [ "error", "always" ],
            "@stylistic/space-infix-ops":                 "error",
            "@stylistic/space-unary-ops":                 "error",
            "@stylistic/spaced-comment":                  "error",
            "@stylistic/switch-colon-spacing":            "error",
            "@stylistic/template-curly-spacing":          [ "error", "always" ],
            "@stylistic/template-tag-spacing":            "error",
            "@stylistic/type-annotation-spacing":         "error",
            "@stylistic/type-generic-spacing":            "error",
            "@stylistic/type-named-tuple-spacing":        "error",
            "@stylistic/wrap-iife":                       [ "error", "inside" ],
            "@stylistic/wrap-regex":                      "error",
            "@stylistic/yield-star-spacing":              "error",
            "@stylistic/padding-line-between-statements": [
                "error",
                {
                    "blankLine": "always",
                    "prev":      "*",
                    "next":      "return",
                },
                {
                    "blankLine": "always",
                    "prev":      "*",
                    "next":      "function",
                },
                {
                    "blankLine": "always",
                    "prev":      "*",
                    "next":      "export",
                },
                {
                    "blankLine": "always",
                    "prev":      "*",
                    "next":      "class",
                },
                {
                    "blankLine": "always",
                    "prev":      "*",
                    "next":      "interface",
                },
                {
                    "blankLine": "always",
                    "prev":      "*",
                    "next":      "type",
                },
                {
                    "blankLine": "always",
                    "prev":      "*",
                    "next":      "function-overload",
                },
                {
                    "blankLine": "always",
                    "prev":      "*",
                    "next":      "enum",
                },
                {
                    "blankLine": "always",
                    "prev":      "*",
                    "next":      "continue",
                },
                {
                    "blankLine": "always",
                    "prev":      "*",
                    "next":      "throw",
                },
                {
                    "blankLine": "always",
                    "prev":      "directive",
                    "next":      "*",
                },
                {
                    "blankLine": "any",
                    "prev":      "directive",
                    "next":      "directive",
                },
                {
                    "blankLine": "always",
                    "prev":      "import",
                    "next":      "*",
                },
                {
                    "blankLine": "any",
                    "prev":      "import",
                    "next":      "import",
                },
                {
                    "blankLine": "always",
                    "prev":      [ "case", "default" ],
                    "next":      "*",
                },
            ],

        },
    },
];
