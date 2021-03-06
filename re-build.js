/*!
 * RE-Build - v1.0.0
 * by Massimo Artizzu (MaxArt2501)
 *
 * https://github.com/MaxArt2501/re-build
 *
 * Licensed under the MIT License
 * See LICENSE for details
 */

(function (root, factory) {
    if (typeof define === "function" && define.amd) {
        // AMD. Register as an anonymous module.
        define([], factory);
    } else if (typeof exports === "object") {
        // Node. Does not work with strict CommonJS, but
        // only CommonJS-like environments that support module.exports,
        // like Node.
        module.exports = factory();
    } else {
        // Browser globals (root is window)
        root.RE = factory();
    }
})(this, function() {
    "use strict";

    var O = Object;
    var extend = O.assign || function(dest) {
        for (var i = 1, source, prop; i < arguments.length;) {
            source = arguments[i++];
            if (source)
                for (var prop in source)
                    dest[prop] = source[prop];
        }

        return dest;
    };
    var defineProps = O.defineProperties;

    var flags = [ "global", "ignoreCase", "multiline", "unicode", "sticky" ],
        settingList = flags.concat([ "min", "max", "lazy", "negate" ]);

    var /** @const */ NOQUANTIFY = 1,
        /** @const */ NOSETS = 2;

    var getCodePointAt = "".codePointAt ? function(string, index) {
        return string.codePointAt(index);
    } : function(string, index) {
        var code = string.charCodeAt(index);
        if (code >= 0xd800 && code <= 0xdbff) {
            var surr = string.charCodeAt(index + 1);
            if (surr >= 0xdc00 && surr <= 0xdfff)
                code = 0x10000 + ((code - 0xd800) << 10) + (surr - 0xdc00);
        }

        return code;
    };

    var names = {
        digit: ["\\d", "\\D"],
        alphaNumeric: [ "\\w", "\\W"],
        whiteSpace: ["\\s", "\\S"],
        wordBoundary: ["\\b", "\\B", NOQUANTIFY + NOSETS],
        anyChar: [".", "", NOSETS],

        tab: ["\\t"],
        vTab: ["\\v"],
        cReturn: ["\\r"],
        newLine: ["\\n"],
        formFeed: ["\\f"],
        null: ["\\0"],
        slash: ["\\/"],
        backslash: ["\\\\"],

        theStart: ["^", "", NOQUANTIFY + NOSETS],
        theEnd: ["$", "", NOQUANTIFY + NOSETS],

        ascii: [function() {
            var source = "";
            for (var i = 0, j = 0; i < arguments.length; i++) {
                var arg = arguments[i], code;
                if (typeof arg === "string") {
                    code = arg.charCodeAt(j++);
                    if (j < arg.length) i--;
                    else j = 0;
                } else code = arg|0;
                if (code < 0 || code > 255)
                    throw new RangeError("Invalid character code");

                source += "\\x" + ("0" + code.toString(16)).slice(-2);
            }

            return source;
        }],
        codePoint: [function() {
            var source = "",
                unicode = this.unicode;

            for (var i = 0, j = 0; i < arguments.length; i++) {
                var arg = arguments[i], code;
                if (typeof arg === "string") {
                    code = unicode ? getCodePointAt(arg, j) : arg.charCodeAt(j);
                    j += code > 0xffff ? 2 : 1;
                    if (j < arg.length) i--;
                    else j = 0;
                } else code = arg|0;

                if (code < 0 || code > 0x10ffff)
                    throw new RangeError("Invalid code point " + code);
                if (code > 0xffff && !unicode) {
                    // Computing surrogate code points
                    code -= 0x10000;
                    // First surrogate is immediately added to the source
                    source += "\\u" + (0xd800 + (code >> 10)).toString(16);
                    code = 0xdc00 + (code & 0x3ff);
                }

                source += "\\u" + (code > 0xffff ? "{" + code.toString(16) + "}" : ("000" + code.toString(16)).slice(-4));
            }

            return source;
        }],
        control: [function(letter) {
            if (!/^[a-zA-Z]$/.test(letter))
                throw new RangeError("Invalid control code");

            return "\\c" + letter.toUpperCase();
        }],

        group: [function() {
            var source = parseArgs(arguments);
            if (source.slice(0, 3) !== "(?:")
                source = "(?:" + source + ")";

            return source;
        }, 0, NOSETS],
        capture: [function() {
            var source = parseArgs(arguments);
            if (source.slice(0, 3) === "(?:")
                source = "(" + source.slice(3);
            else if (source.charAt(0) !== "(")
                source = "(" + source + ")";

            return source;
        }, 0, NOSETS],
        reference: [function(number) {
            if (typeof number !== "number" || number !== number | 0 || number < 0)
                throw new RangeError("Invalid back reference number");

            return "\\" + number;
        }, 0, NOSETS]
    };

    var flagger = {
        withFlags: function() {
            return function(flags) {
                var consts = {};
                if (typeof flags === "string")
                    consts = {
                        global: ~flags.indexOf("g"),
                        ignoreCase: ~flags.indexOf("i"),
                        multiline: ~flags.indexOf("m"),
                        unicode: ~flags.indexOf("u"),
                        sticky: ~flags.indexOf("y")
                    }
                else if (typeof flags === "object")
                    flags.forEach(function(f) { consts[f] = this[f]; }, flags);

                return buildBuilder(setConsts({}, consts), [ matcher ]);
            };
        }
    };
    flags.forEach(function(flag) {
        flagger[this[flag]] = function() {
            var consts = {};
            flags.forEach(function(f) { consts[f] = f === flag || this[f]; }, this);

            return buildBuilder(setConsts({}, consts), [ flagger, matcher ]);
        };
    }, {
        global: "globally",
        ignoreCase: "anyCase",
        multiline: "fullText",
        unicode: "withUnicode",
        sticky: "stickily"
    });

    var matcher = {
        matching: function() {
            return buildBuilder(initFunc(function() {
                return buildBuilder(createBuilder(getFlags(this), parseArgs(arguments)), [ thenable ]);
            }, getFlags(this)), [ openable, lookAheads, negator([ negable, lookAheads ]) ]);
        }
    };

    var quantifiers = {
        between: function() {
            return function(min, max) {
                if (min != null && (isNaN(min) || Math.floor(min) !== +min || +min < 0)
                        || max != null && (isNaN(max) || Math.floor(max) !== +max || +max < 0))
                    throw new RangeError("Non-negative integer expected");

                if (min == null && max == null)
                    throw new RangeError("Range expected");

                var that = this,
                    source = this.source,
                    settings = extend(getSettings(this), { min: min, max: max });

                return buildBuilder(initFunc(function() {
                    return buildBuilder(createBuilder(getFlags(that),
                            source + wrapSource(parseArgs(arguments), settings)), [ thenable ]);
                }, settings, source), [ quantifiable, negator([ qntnegable ]) ]);
            };
        },
        exactly: function() {
            return function(quantity) {
                return this.between(quantity, quantity);
            };
        },
        atLeast: function() {
            return function(quantity) {
                return this.between(quantity, this.max);
            };
        },
        atMost: function() {
            return function(quantity) {
                return this.between(this.min, quantity);
            };
        },
        anyAmountOf: function() {
            return this.between(0, Infinity);
        },
        noneOrOne: function() {
            return this.between(0, 1);
        },
        oneOrMore: function() {
            return this.between(1, Infinity);
        }
    };

    var lazinator = {
        lazily: function() {
            return buildBuilder(createBuilder(extend(getSettings(this), { lazy: true }), this.source), [ quantifiers ]);
        }
    };

    var thenable = {
        then: function() {
            var settings = getFlags(this),
                source = this.source;

            return buildBuilder(initFunc(function() {
                return buildBuilder(createBuilder(settings,
                        source + parseArgs(arguments)), [ thenable ]);
            }, settings, source), [ openable, negator([ negable ]) ]);
        },
        or: function() {
            var settings = getFlags(this),
                source = this.source + "|";

            return buildBuilder(initFunc(function() {
                return buildBuilder(createBuilder(settings,
                        source + parseArgs(arguments)), [ thenable ]);
            }, settings, source), [ openable, lookAheads, negator([ negable, lookAheads ]) ]);
        }
    };

    var openable = {}, negable = {},
        settable = {}, setnegable = {},
        quantifiable = {}, qntnegable = {};

    O.keys(names).forEach(function(name) {
        var def = names[name];

        if (typeof def[0] === "string") {
            openable[name] = function() {
                var source = this.source + wrapSource(this.negate && def[1] || def[0], this);
                return buildBuilder(createBuilder(getFlags(this), source), [ thenable ]);
            };
            if (def[1]) negable[name] = openable[name];
        } else
            openable[name] = function() {
                return function() {
                    var source = this.source + wrapSource(def[0].apply(this, arguments), this);
                    return buildBuilder(createBuilder(getFlags(this), source), [ thenable ]);
                }
            };
        if (!(def[2] & NOQUANTIFY)) {
            quantifiable[name] = openable[name];
            if (def[1]) qntnegable[name] = openable[name];
        }

        if (!(def[2] & NOSETS)) {
            if (typeof def[0] === "string") {
                settable[name] = function() {
                    var source = this.source,
                        lastBracket = source.lastIndexOf("]");
                    return buildBuilder(createBuilder(getFlags(this), source.slice(0, lastBracket)
                            + (this.negate && def[1] || def[0]) + source.slice(lastBracket)), [ thenable, andCharSet ]);
                };
                if (def[1]) setnegable[name] = settable[name];
            } else
                settable[name] = function() {
                    return function() {
                        var source = this.source,
                            lastBracket = source.lastIndexOf("]");
                        return buildBuilder(createBuilder(getFlags(this), source.slice(0, lastBracket)
                                + def[0].apply(this, arguments) + source.slice(lastBracket)), [ thenable, andCharSet ]);
                    };
                };
        }
    });
    openable.oneOf = negable.oneOf = quantifiable.oneOf = qntnegable.oneOf = function() {
        var that = this, source = this.source;

        return buildBuilder(initFunc(function() {
            return buildBuilder(createBuilder(getFlags(that), source
                    + wrapSource((that.negate ? "[^" : "[") + parseSets(arguments) + "]", that)), [ andCharSet, thenable ]);
        }, getSettings(this), source + wrapSource(this.negate ? "[^]" : "[]", this)), [ settable ]);
    };
    extend(openable, quantifiers, lazinator);

    settable.backspace = function() {
        var source = this.source,
            lastBracket = source.lastIndexOf("]");
        return buildBuilder(createBuilder(getFlags(this), source.slice(0, lastBracket)
                + "\\b" + source.slice(lastBracket)), [ thenable, andCharSet ]);
    };
    settable.range = function() {
        function checkBoundary(bnd) {
            if (typeof bnd === "string" && bnd.length === 1)
                return parseSets(bnd);

            if (isBuilder(bnd)) {
                bnd = bnd.source;
                if (bnd.length === 1 || /^\\(?:[0btnvfr\/\\]|x[\da-fA-F]{2}|u[\da-fA-F]{4}|c[a-zA-Z])$/.test(bnd))
                    return bnd;
            }

            throw new RangeError("Incorrect character range");
        }
        return function(start, end) {
            start = checkBoundary(start);
            end = checkBoundary(end);

            var source = this.source,
                lastBracket = source.lastIndexOf("]");
            return buildBuilder(createBuilder(getFlags(this), source.slice(0, lastBracket)
                    + start + "-" + end + source.slice(lastBracket)),
                    [ thenable, andCharSet ]);
        };
    };
    extend(settable, negator([ setnegable ]));

    var andCharSet = {
        and: function() {
            var flags = getFlags(this), source = this.source;

            return buildBuilder(initFunc(function() {
                var lastBracket = source.lastIndexOf("]");
                return buildBuilder(createBuilder(flags, source.slice(0, lastBracket)
                        + parseSets(arguments) + source.slice(lastBracket)), [ andCharSet, thenable ]);
            }, flags, source), [ settable ]);
        }
    };

    var lookAheads = {
        followedBy: function() {
            return function() {
                var source = wrapSource(parseArgs(arguments), this),
                    seq = this.negate ? "(?!" : "(?=";
                if (source.slice(0, 3) !== seq)
                    source = seq + source + ")";

                return buildBuilder(createBuilder(getFlags(this), (this.source || "") + source), [ thenable ]);
            };
        }
    };
    extend(thenable, lookAheads);

    function negator(bundles) {
        return { not: function() {
            return buildBuilder(createBuilder(extend(getSettings(this), { negate: true }), this.source), bundles);
        } };
    }

    /**
     * Adds the eventual quantifier to a chunk of regex source, conveniently
     * wrapping it in a non-capturing group if it contains more than a block.
     * @param {string} source
     * @param {Object} settings  Quantifying settings (min, max and lazy).
     * @returns {string}         Quantified source
     */
    function wrapSource(source, settings) {
        if (typeof settings.min === "number" || typeof settings.max === "number") {
            var quantifier,
                min = typeof settings.min === "number" ? settings.min : 0,
                max = typeof settings.max === "number" ? settings.max : Infinity;

            if (min === max)
                quantifier = min === 1 ? "" : "{" + min + "}";
            else if (min === 0)
                quantifier = max === 1 ? "?"
                        : max === Infinity ? "*"
                        : "{," + max + "}";
            else if (min === 1)
                quantifier = max === Infinity ? "+" : "{1," + max + "}";
            else quantifier = "{" + min + "," + (max === Infinity ? "" : max) + "}";

            if (quantifier) {
                if ((source.length > 2 || source.length === 2 && source[0] !== "\\") && hasManyBlocks(source))
                    source = "(?:" + source + ")";
                source += quantifier + (settings.lazy ? "?" : "");
            }
        }

        return source;
    }

    function getConstMap(consts) {
        var map = {};
        for (var name in consts)
            map[name] = { value: consts[name], writable: false, configurable: false };

        return map;
    }
    function setConsts(dest, consts) {
        return defineProps(dest, getConstMap(consts));
    }

    function initFunc(fnc, consts, source) {
        consts.source = source || "";
        return setConsts(fnc, consts);
    }

    /**
    */
    function reparser(blocks) {
        var source = "", i = 0, block;
        while (i < blocks.length) {
            block = blocks[i++];
            if (typeof block === "string")
                source += block.replace(this, "\\$&");
            else if (block instanceof RegExp || isBuilder(block))
                source += block.source;
        }
        return source;
    }
    var parseArgs = reparser.bind(/[\^\$\/\.\*\+\?\|\(\)\[\]\{\}\\]/g),
        parseSets = reparser.bind(/[\^\/\[\]\\-]/g);

    function hasManyBlocks(source) {
        var len = source.length;
        if (len < 2 || len === 2 && (source[0] === "\\" || source === "[]" || source === "()")) return false;

        if (source[0] === "[" && source[len - 1] === "]")
            return source.search(/[^\\]\]/) < len - 2;

        if (source[0] === "(" && source[len - 1] === ")") {
            var re = /[\(\)]/g, count = 1, match;
            re.lastIndex = 1;
            while (match = re.exec(source)) {
                if (source[match.index - 1] === "\\") continue;
                if (match[0] === ")") {
                    if (!--count)
                        return match.index < len - 1;
                } else count++;
            }
        }

        return true;
    }

    function getSettings(object, props) {
        if (!props) props = settingList;
        for (var i = 0, sets = {}; i < props.length; i++)
            sets[props[i]] = object[props[i]];

        return sets;
    }
    function getFlags(object) { return getSettings(object, flags); }

    /**
     * RegExpBuilder factory function
     */
    function buildBuilder(dest, bundles) {
        var i = 0, bundle, prop, defs = {};
        while (i < bundles.length) {
            bundle = bundles[i++];
            for (prop in bundle) {
                defs[prop] = { configurable: false, enumerable: true };
                if (typeof bundle[prop] === "function") {
                    defs[prop].get = bundle[prop];
                } else {
                    defs[prop].value = bundle[prop];
                    defs[prop].writable = false;
                }
            }
        }

        return defineProps(dest, defs);
    }

    var proto = {
        valueOf: function() { return this.regex; },
        toString: function() { return "/" + this.source + "/" + this.flags; },
        test: function(string) { return this.regex.test(string); },
        exec: function(string) { return this.regex.exec(string); },
        replace: function(string, subs) { return string.replace(this.regex, subs); },
        split: function(string) { return string.split(this.regex); },
        search: function(string) { return string.search(this.regex); }
    };
    proto.toRegExp = proto.valueOf;

    function getPropDefs(settings, source) {
        if (typeof source !== "string") source = "";

        var flags = (settings.global ? "g" : "")
                + (settings.ignoreCase ? "i" : "")
                + (settings.multiline ? "m" : "")
                + (settings.unicode ? "u" : "")
                + (settings.sticky ? "y" : "");

        var defs = getConstMap({
            global: settings.global,
            ignoreCase: settings.ignoreCase,
            multiline: settings.multiline,
            sticky: settings.sticky,
            negate: settings.negate,
            lazy: settings.lazy,
            min: settings.min,
            max: settings.max,
            source: source,
            flags: flags
        });
        var regex;
        defs.regex = {
            get: function() {
                return regex || (regex = new RegExp(source, flags));
            },
            configurable: false
        };

        return defs;
    }

    function createBuilder(settings, source) {
        var defs = getPropDefs(settings, source);
        defs.regex.configurable = false;

        return O.create(proto, defs);
    };
    function isBuilder(object) {
        return proto.isPrototypeOf(object);
    }

    function RE() {
        return buildBuilder(createBuilder(getFlags(RE), parseArgs(arguments)), [ thenable ]);
    }

    buildBuilder(initFunc(RE,
        { global: false, ignoreCase: false, multiline: false, unicode: false, sticky: false }),
        [ openable, flagger, matcher ]);

    return RE;
});
