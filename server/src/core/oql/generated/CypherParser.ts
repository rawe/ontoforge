
import * as antlr from "antlr4ng";
import { Token } from "antlr4ng";

import { CypherParserListener } from "./CypherParserListener.js";
// for running tests with parameters, TODO: discuss strategy for typed parameters in CI
// eslint-disable-next-line no-unused-vars
type int = number;


export class CypherParser extends antlr.Parser {
    public static readonly ASSIGN = 1;
    public static readonly ADD_ASSIGN = 2;
    public static readonly LE = 3;
    public static readonly GE = 4;
    public static readonly GT = 5;
    public static readonly LT = 6;
    public static readonly NOT_EQUAL = 7;
    public static readonly RANGE = 8;
    public static readonly SEMI = 9;
    public static readonly DOT = 10;
    public static readonly COMMA = 11;
    public static readonly LPAREN = 12;
    public static readonly RPAREN = 13;
    public static readonly LBRACE = 14;
    public static readonly RBRACE = 15;
    public static readonly LBRACK = 16;
    public static readonly RBRACK = 17;
    public static readonly SUB = 18;
    public static readonly PLUS = 19;
    public static readonly DIV = 20;
    public static readonly MOD = 21;
    public static readonly CARET = 22;
    public static readonly MULT = 23;
    public static readonly ESC = 24;
    public static readonly COLON = 25;
    public static readonly STICK = 26;
    public static readonly DOLLAR = 27;
    public static readonly CALL = 28;
    public static readonly YIELD = 29;
    public static readonly FILTER = 30;
    public static readonly EXTRACT = 31;
    public static readonly COUNT = 32;
    public static readonly ANY = 33;
    public static readonly NONE = 34;
    public static readonly SINGLE = 35;
    public static readonly ALL = 36;
    public static readonly ASC = 37;
    public static readonly ASCENDING = 38;
    public static readonly BY = 39;
    public static readonly CREATE = 40;
    public static readonly DELETE = 41;
    public static readonly DESC = 42;
    public static readonly DESCENDING = 43;
    public static readonly DETACH = 44;
    public static readonly EXISTS = 45;
    public static readonly LIMIT = 46;
    public static readonly MATCH = 47;
    public static readonly MERGE = 48;
    public static readonly ON = 49;
    public static readonly OPTIONAL = 50;
    public static readonly ORDER = 51;
    public static readonly REMOVE = 52;
    public static readonly RETURN = 53;
    public static readonly SET = 54;
    public static readonly SKIP_W = 55;
    public static readonly WHERE = 56;
    public static readonly WITH = 57;
    public static readonly UNION = 58;
    public static readonly UNWIND = 59;
    public static readonly AND = 60;
    public static readonly AS = 61;
    public static readonly CONTAINS = 62;
    public static readonly DISTINCT = 63;
    public static readonly ENDS = 64;
    public static readonly IN = 65;
    public static readonly IS = 66;
    public static readonly NOT = 67;
    public static readonly OR = 68;
    public static readonly STARTS = 69;
    public static readonly XOR = 70;
    public static readonly FALSE = 71;
    public static readonly TRUE = 72;
    public static readonly NULL_W = 73;
    public static readonly CONSTRAINT = 74;
    public static readonly DO = 75;
    public static readonly FOR = 76;
    public static readonly REQUIRE = 77;
    public static readonly UNIQUE = 78;
    public static readonly CASE = 79;
    public static readonly WHEN = 80;
    public static readonly THEN = 81;
    public static readonly ELSE = 82;
    public static readonly END = 83;
    public static readonly MANDATORY = 84;
    public static readonly SCALAR = 85;
    public static readonly OF = 86;
    public static readonly ADD = 87;
    public static readonly DROP = 88;
    public static readonly ESC_LITERAL = 89;
    public static readonly CHAR_LITERAL = 90;
    public static readonly STRING_LITERAL = 91;
    public static readonly Integer = 92;
    public static readonly DIGIT = 93;
    public static readonly FLOAT = 94;
    public static readonly ID = 95;
    public static readonly IdentifierStart = 96;
    public static readonly IdentifierPart = 97;
    public static readonly Letter = 98;
    public static readonly SP = 99;
    public static readonly WHITESPACE = 100;
    public static readonly Comment = 101;
    public static readonly RULE_script = 0;
    public static readonly RULE_query = 1;
    public static readonly RULE_regularQuery = 2;
    public static readonly RULE_singleQuery = 3;
    public static readonly RULE_standaloneCall = 4;
    public static readonly RULE_returnSt = 5;
    public static readonly RULE_withSt = 6;
    public static readonly RULE_skipSt = 7;
    public static readonly RULE_limitSt = 8;
    public static readonly RULE_projectionBody = 9;
    public static readonly RULE_projectionItems = 10;
    public static readonly RULE_projectionItem = 11;
    public static readonly RULE_orderItem = 12;
    public static readonly RULE_orderSt = 13;
    public static readonly RULE_singlePartQ = 14;
    public static readonly RULE_multiPartQ = 15;
    public static readonly RULE_matchSt = 16;
    public static readonly RULE_unwindSt = 17;
    public static readonly RULE_readingStatement = 18;
    public static readonly RULE_updatingStatement = 19;
    public static readonly RULE_deleteSt = 20;
    public static readonly RULE_removeSt = 21;
    public static readonly RULE_removeItem = 22;
    public static readonly RULE_queryCallSt = 23;
    public static readonly RULE_parenExpressionChain = 24;
    public static readonly RULE_yieldItems = 25;
    public static readonly RULE_yieldItem = 26;
    public static readonly RULE_mergeSt = 27;
    public static readonly RULE_mergeAction = 28;
    public static readonly RULE_setSt = 29;
    public static readonly RULE_setItem = 30;
    public static readonly RULE_nodeLabels = 31;
    public static readonly RULE_createSt = 32;
    public static readonly RULE_patternWhere = 33;
    public static readonly RULE_where = 34;
    public static readonly RULE_pattern = 35;
    public static readonly RULE_expression = 36;
    public static readonly RULE_xorExpression = 37;
    public static readonly RULE_andExpression = 38;
    public static readonly RULE_notExpression = 39;
    public static readonly RULE_comparisonExpression = 40;
    public static readonly RULE_comparisonSigns = 41;
    public static readonly RULE_addSubExpression = 42;
    public static readonly RULE_multDivExpression = 43;
    public static readonly RULE_powerExpression = 44;
    public static readonly RULE_unaryAddSubExpression = 45;
    public static readonly RULE_atomicExpression = 46;
    public static readonly RULE_listExpression = 47;
    public static readonly RULE_stringExpression = 48;
    public static readonly RULE_stringExpPrefix = 49;
    public static readonly RULE_nullExpression = 50;
    public static readonly RULE_propertyOrLabelExpression = 51;
    public static readonly RULE_propertyExpression = 52;
    public static readonly RULE_patternPart = 53;
    public static readonly RULE_patternElem = 54;
    public static readonly RULE_patternElemChain = 55;
    public static readonly RULE_properties = 56;
    public static readonly RULE_nodePattern = 57;
    public static readonly RULE_atom = 58;
    public static readonly RULE_lhs = 59;
    public static readonly RULE_relationshipPattern = 60;
    public static readonly RULE_relationDetail = 61;
    public static readonly RULE_rangeLit = 62;
    public static readonly RULE_relationshipTypes = 63;
    public static readonly RULE_unionSt = 64;
    public static readonly RULE_subqueryExist = 65;
    public static readonly RULE_invocationName = 66;
    public static readonly RULE_functionInvocation = 67;
    public static readonly RULE_parenthesizedExpression = 68;
    public static readonly RULE_filterWith = 69;
    public static readonly RULE_patternComprehension = 70;
    public static readonly RULE_relationshipsChainPattern = 71;
    public static readonly RULE_listComprehension = 72;
    public static readonly RULE_filterExpression = 73;
    public static readonly RULE_countAll = 74;
    public static readonly RULE_expressionChain = 75;
    public static readonly RULE_caseExpression = 76;
    public static readonly RULE_parameter = 77;
    public static readonly RULE_literal = 78;
    public static readonly RULE_boolLit = 79;
    public static readonly RULE_numLit = 80;
    public static readonly RULE_stringLit = 81;
    public static readonly RULE_charLit = 82;
    public static readonly RULE_listLit = 83;
    public static readonly RULE_mapLit = 84;
    public static readonly RULE_mapPair = 85;
    public static readonly RULE_name = 86;
    public static readonly RULE_symbol = 87;
    public static readonly RULE_reservedWord = 88;

    public static readonly literalNames = [
        null, "'='", "'+='", "'<='", "'>='", "'>'", "'<'", "'<>'", "'..'", 
        "';'", "'.'", "','", "'('", "')'", "'{'", "'}'", "'['", "']'", "'-'", 
        "'+'", "'/'", "'%'", "'^'", "'*'", "'`'", "':'", "'|'", "'$'", "'CALL'", 
        "'YIELD'", "'FILTER'", "'EXTRACT'", "'COUNT'", "'ANY'", "'NONE'", 
        "'SINGLE'", "'ALL'", "'ASC'", "'ASCENDING'", "'BY'", "'CREATE'", 
        "'DELETE'", "'DESC'", "'DESCENDING'", "'DETACH'", "'EXISTS'", "'LIMIT'", 
        "'MATCH'", "'MERGE'", "'ON'", "'OPTIONAL'", "'ORDER'", "'REMOVE'", 
        "'RETURN'", "'SET'", "'SKIP'", "'WHERE'", "'WITH'", "'UNION'", "'UNWIND'", 
        "'AND'", "'AS'", "'CONTAINS'", "'DISTINCT'", "'ENDS'", "'IN'", "'IS'", 
        "'NOT'", "'OR'", "'STARTS'", "'XOR'", "'FALSE'", "'TRUE'", "'NULL'", 
        "'CONSTRAINT'", "'DO'", "'FOR'", "'REQUIRE'", "'UNIQUE'", "'CASE'", 
        "'WHEN'", "'THEN'", "'ELSE'", "'END'", "'MANDATORY'", "'SCALAR'", 
        "'OF'", "'ADD'", "'DROP'"
    ];

    public static readonly symbolicNames = [
        null, "ASSIGN", "ADD_ASSIGN", "LE", "GE", "GT", "LT", "NOT_EQUAL", 
        "RANGE", "SEMI", "DOT", "COMMA", "LPAREN", "RPAREN", "LBRACE", "RBRACE", 
        "LBRACK", "RBRACK", "SUB", "PLUS", "DIV", "MOD", "CARET", "MULT", 
        "ESC", "COLON", "STICK", "DOLLAR", "CALL", "YIELD", "FILTER", "EXTRACT", 
        "COUNT", "ANY", "NONE", "SINGLE", "ALL", "ASC", "ASCENDING", "BY", 
        "CREATE", "DELETE", "DESC", "DESCENDING", "DETACH", "EXISTS", "LIMIT", 
        "MATCH", "MERGE", "ON", "OPTIONAL", "ORDER", "REMOVE", "RETURN", 
        "SET", "SKIP_W", "WHERE", "WITH", "UNION", "UNWIND", "AND", "AS", 
        "CONTAINS", "DISTINCT", "ENDS", "IN", "IS", "NOT", "OR", "STARTS", 
        "XOR", "FALSE", "TRUE", "NULL_W", "CONSTRAINT", "DO", "FOR", "REQUIRE", 
        "UNIQUE", "CASE", "WHEN", "THEN", "ELSE", "END", "MANDATORY", "SCALAR", 
        "OF", "ADD", "DROP", "ESC_LITERAL", "CHAR_LITERAL", "STRING_LITERAL", 
        "Integer", "DIGIT", "FLOAT", "ID", "IdentifierStart", "IdentifierPart", 
        "Letter", "SP", "WHITESPACE", "Comment"
    ];
    public static readonly ruleNames = [
        "script", "query", "regularQuery", "singleQuery", "standaloneCall", 
        "returnSt", "withSt", "skipSt", "limitSt", "projectionBody", "projectionItems", 
        "projectionItem", "orderItem", "orderSt", "singlePartQ", "multiPartQ", 
        "matchSt", "unwindSt", "readingStatement", "updatingStatement", 
        "deleteSt", "removeSt", "removeItem", "queryCallSt", "parenExpressionChain", 
        "yieldItems", "yieldItem", "mergeSt", "mergeAction", "setSt", "setItem", 
        "nodeLabels", "createSt", "patternWhere", "where", "pattern", "expression", 
        "xorExpression", "andExpression", "notExpression", "comparisonExpression", 
        "comparisonSigns", "addSubExpression", "multDivExpression", "powerExpression", 
        "unaryAddSubExpression", "atomicExpression", "listExpression", "stringExpression", 
        "stringExpPrefix", "nullExpression", "propertyOrLabelExpression", 
        "propertyExpression", "patternPart", "patternElem", "patternElemChain", 
        "properties", "nodePattern", "atom", "lhs", "relationshipPattern", 
        "relationDetail", "rangeLit", "relationshipTypes", "unionSt", "subqueryExist", 
        "invocationName", "functionInvocation", "parenthesizedExpression", 
        "filterWith", "patternComprehension", "relationshipsChainPattern", 
        "listComprehension", "filterExpression", "countAll", "expressionChain", 
        "caseExpression", "parameter", "literal", "boolLit", "numLit", "stringLit", 
        "charLit", "listLit", "mapLit", "mapPair", "name", "symbol", "reservedWord",
    ];

    public get grammarFileName(): string { return "CypherParser.g4"; }
    public get literalNames(): (string | null)[] { return CypherParser.literalNames; }
    public get symbolicNames(): (string | null)[] { return CypherParser.symbolicNames; }
    public get ruleNames(): string[] { return CypherParser.ruleNames; }
    public get serializedATN(): number[] { return CypherParser._serializedATN; }

    protected createFailedPredicateException(predicate?: string, message?: string): antlr.FailedPredicateException {
        return new antlr.FailedPredicateException(this, predicate, message);
    }

    public constructor(input: antlr.TokenStream) {
        super(input);
        this.interpreter = new antlr.ParserATNSimulator(this, CypherParser._ATN, CypherParser.decisionsToDFA, new antlr.PredictionContextCache());
    }
    public script(): ScriptContext {
        let localContext = new ScriptContext(this.context, this.state);
        this.enterRule(localContext, 0, CypherParser.RULE_script);
        let _la: number;
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 179;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 178;
                this.match(CypherParser.SP);
                }
            }

            this.state = 181;
            this.query();
            this.state = 183;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 1, this.context) ) {
            case 1:
                {
                this.state = 182;
                this.match(CypherParser.SP);
                }
                break;
            }
            this.state = 186;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 9) {
                {
                this.state = 185;
                this.match(CypherParser.SEMI);
                }
            }

            this.state = 189;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 188;
                this.match(CypherParser.SP);
                }
            }

            this.state = 191;
            this.match(CypherParser.EOF);
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public query(): QueryContext {
        let localContext = new QueryContext(this.context, this.state);
        this.enterRule(localContext, 2, CypherParser.RULE_query);
        try {
            this.state = 195;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 4, this.context) ) {
            case 1:
                this.enterOuterAlt(localContext, 1);
                {
                this.state = 193;
                this.regularQuery();
                }
                break;
            case 2:
                this.enterOuterAlt(localContext, 2);
                {
                this.state = 194;
                this.standaloneCall();
                }
                break;
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public regularQuery(): RegularQueryContext {
        let localContext = new RegularQueryContext(this.context, this.state);
        this.enterRule(localContext, 4, CypherParser.RULE_regularQuery);
        let _la: number;
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 197;
            this.singleQuery();
            this.state = 201;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            while (_la === 58) {
                {
                {
                this.state = 198;
                this.unionSt();
                }
                }
                this.state = 203;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
            }
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public singleQuery(): SingleQueryContext {
        let localContext = new SingleQueryContext(this.context, this.state);
        this.enterRule(localContext, 6, CypherParser.RULE_singleQuery);
        try {
            this.state = 206;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 6, this.context) ) {
            case 1:
                this.enterOuterAlt(localContext, 1);
                {
                this.state = 204;
                this.singlePartQ();
                }
                break;
            case 2:
                this.enterOuterAlt(localContext, 2);
                {
                this.state = 205;
                this.multiPartQ();
                }
                break;
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public standaloneCall(): StandaloneCallContext {
        let localContext = new StandaloneCallContext(this.context, this.state);
        this.enterRule(localContext, 8, CypherParser.RULE_standaloneCall);
        let _la: number;
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 208;
            this.match(CypherParser.CALL);
            this.state = 210;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 209;
                this.match(CypherParser.SP);
                }
            }

            this.state = 212;
            this.invocationName();
            this.state = 214;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 8, this.context) ) {
            case 1:
                {
                this.state = 213;
                this.match(CypherParser.SP);
                }
                break;
            }
            this.state = 217;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 12) {
                {
                this.state = 216;
                this.parenExpressionChain();
                }
            }

            this.state = 230;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 13, this.context) ) {
            case 1:
                {
                this.state = 220;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 219;
                    this.match(CypherParser.SP);
                    }
                }

                this.state = 222;
                this.match(CypherParser.YIELD);
                this.state = 224;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 223;
                    this.match(CypherParser.SP);
                    }
                }

                this.state = 228;
                this.errorHandler.sync(this);
                switch (this.tokenStream.LA(1)) {
                case CypherParser.MULT:
                    {
                    this.state = 226;
                    this.match(CypherParser.MULT);
                    }
                    break;
                case CypherParser.FILTER:
                case CypherParser.EXTRACT:
                case CypherParser.COUNT:
                case CypherParser.ANY:
                case CypherParser.NONE:
                case CypherParser.SINGLE:
                case CypherParser.ESC_LITERAL:
                case CypherParser.Integer:
                case CypherParser.DIGIT:
                case CypherParser.ID:
                    {
                    this.state = 227;
                    this.yieldItems();
                    }
                    break;
                default:
                    throw new antlr.NoViableAltException(this);
                }
                }
                break;
            }
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public returnSt(): ReturnStContext {
        let localContext = new ReturnStContext(this.context, this.state);
        this.enterRule(localContext, 10, CypherParser.RULE_returnSt);
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 232;
            this.match(CypherParser.RETURN);
            this.state = 234;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 14, this.context) ) {
            case 1:
                {
                this.state = 233;
                this.match(CypherParser.SP);
                }
                break;
            }
            this.state = 236;
            this.projectionBody();
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public withSt(): WithStContext {
        let localContext = new WithStContext(this.context, this.state);
        this.enterRule(localContext, 12, CypherParser.RULE_withSt);
        let _la: number;
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 238;
            this.match(CypherParser.WITH);
            this.state = 240;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 15, this.context) ) {
            case 1:
                {
                this.state = 239;
                this.match(CypherParser.SP);
                }
                break;
            }
            this.state = 242;
            this.projectionBody();
            this.state = 247;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 17, this.context) ) {
            case 1:
                {
                this.state = 244;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 243;
                    this.match(CypherParser.SP);
                    }
                }

                this.state = 246;
                this.where();
                }
                break;
            }
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public skipSt(): SkipStContext {
        let localContext = new SkipStContext(this.context, this.state);
        this.enterRule(localContext, 14, CypherParser.RULE_skipSt);
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 249;
            this.match(CypherParser.SKIP_W);
            this.state = 251;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 18, this.context) ) {
            case 1:
                {
                this.state = 250;
                this.match(CypherParser.SP);
                }
                break;
            }
            this.state = 253;
            this.expression();
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public limitSt(): LimitStContext {
        let localContext = new LimitStContext(this.context, this.state);
        this.enterRule(localContext, 16, CypherParser.RULE_limitSt);
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 255;
            this.match(CypherParser.LIMIT);
            this.state = 257;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 19, this.context) ) {
            case 1:
                {
                this.state = 256;
                this.match(CypherParser.SP);
                }
                break;
            }
            this.state = 259;
            this.expression();
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public projectionBody(): ProjectionBodyContext {
        let localContext = new ProjectionBodyContext(this.context, this.state);
        this.enterRule(localContext, 18, CypherParser.RULE_projectionBody);
        let _la: number;
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 265;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 21, this.context) ) {
            case 1:
                {
                this.state = 262;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 261;
                    this.match(CypherParser.SP);
                    }
                }

                this.state = 264;
                this.match(CypherParser.DISTINCT);
                }
                break;
            }
            this.state = 268;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 22, this.context) ) {
            case 1:
                {
                this.state = 267;
                this.match(CypherParser.SP);
                }
                break;
            }
            this.state = 270;
            this.projectionItems();
            this.state = 275;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 24, this.context) ) {
            case 1:
                {
                this.state = 272;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 271;
                    this.match(CypherParser.SP);
                    }
                }

                this.state = 274;
                this.orderSt();
                }
                break;
            }
            this.state = 281;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 26, this.context) ) {
            case 1:
                {
                this.state = 278;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 277;
                    this.match(CypherParser.SP);
                    }
                }

                this.state = 280;
                this.skipSt();
                }
                break;
            }
            this.state = 287;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 28, this.context) ) {
            case 1:
                {
                this.state = 284;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 283;
                    this.match(CypherParser.SP);
                    }
                }

                this.state = 286;
                this.limitSt();
                }
                break;
            }
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public projectionItems(): ProjectionItemsContext {
        let localContext = new ProjectionItemsContext(this.context, this.state);
        this.enterRule(localContext, 20, CypherParser.RULE_projectionItems);
        let _la: number;
        try {
            let alternative: number;
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 291;
            this.errorHandler.sync(this);
            switch (this.tokenStream.LA(1)) {
            case CypherParser.MULT:
                {
                this.state = 289;
                this.match(CypherParser.MULT);
                }
                break;
            case CypherParser.LPAREN:
            case CypherParser.LBRACE:
            case CypherParser.LBRACK:
            case CypherParser.SUB:
            case CypherParser.PLUS:
            case CypherParser.DOLLAR:
            case CypherParser.FILTER:
            case CypherParser.EXTRACT:
            case CypherParser.COUNT:
            case CypherParser.ANY:
            case CypherParser.NONE:
            case CypherParser.SINGLE:
            case CypherParser.ALL:
            case CypherParser.EXISTS:
            case CypherParser.NOT:
            case CypherParser.FALSE:
            case CypherParser.TRUE:
            case CypherParser.NULL_W:
            case CypherParser.CASE:
            case CypherParser.ESC_LITERAL:
            case CypherParser.CHAR_LITERAL:
            case CypherParser.STRING_LITERAL:
            case CypherParser.Integer:
            case CypherParser.DIGIT:
            case CypherParser.ID:
            case CypherParser.SP:
                {
                this.state = 290;
                this.projectionItem();
                }
                break;
            default:
                throw new antlr.NoViableAltException(this);
            }
            this.state = 303;
            this.errorHandler.sync(this);
            alternative = this.interpreter.adaptivePredict(this.tokenStream, 32, this.context);
            while (alternative !== 2 && alternative !== antlr.ATN.INVALID_ALT_NUMBER) {
                if (alternative === 1) {
                    {
                    {
                    this.state = 294;
                    this.errorHandler.sync(this);
                    _la = this.tokenStream.LA(1);
                    if (_la === 99) {
                        {
                        this.state = 293;
                        this.match(CypherParser.SP);
                        }
                    }

                    this.state = 296;
                    this.match(CypherParser.COMMA);
                    this.state = 298;
                    this.errorHandler.sync(this);
                    switch (this.interpreter.adaptivePredict(this.tokenStream, 31, this.context) ) {
                    case 1:
                        {
                        this.state = 297;
                        this.match(CypherParser.SP);
                        }
                        break;
                    }
                    this.state = 300;
                    this.projectionItem();
                    }
                    }
                }
                this.state = 305;
                this.errorHandler.sync(this);
                alternative = this.interpreter.adaptivePredict(this.tokenStream, 32, this.context);
            }
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public projectionItem(): ProjectionItemContext {
        let localContext = new ProjectionItemContext(this.context, this.state);
        this.enterRule(localContext, 22, CypherParser.RULE_projectionItem);
        let _la: number;
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 306;
            this.expression();
            this.state = 315;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 35, this.context) ) {
            case 1:
                {
                this.state = 308;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 307;
                    this.match(CypherParser.SP);
                    }
                }

                this.state = 310;
                this.match(CypherParser.AS);
                this.state = 312;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 311;
                    this.match(CypherParser.SP);
                    }
                }

                this.state = 314;
                this.symbol_();
                }
                break;
            }
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public orderItem(): OrderItemContext {
        let localContext = new OrderItemContext(this.context, this.state);
        this.enterRule(localContext, 24, CypherParser.RULE_orderItem);
        let _la: number;
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 317;
            this.expression();
            this.state = 322;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 37, this.context) ) {
            case 1:
                {
                this.state = 319;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 318;
                    this.match(CypherParser.SP);
                    }
                }

                this.state = 321;
                _la = this.tokenStream.LA(1);
                if(!(((((_la - 37)) & ~0x1F) === 0 && ((1 << (_la - 37)) & 99) !== 0))) {
                this.errorHandler.recoverInline(this);
                }
                else {
                    this.errorHandler.reportMatch(this);
                    this.consume();
                }
                }
                break;
            }
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public orderSt(): OrderStContext {
        let localContext = new OrderStContext(this.context, this.state);
        this.enterRule(localContext, 26, CypherParser.RULE_orderSt);
        let _la: number;
        try {
            let alternative: number;
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 324;
            this.match(CypherParser.ORDER);
            this.state = 326;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 325;
                this.match(CypherParser.SP);
                }
            }

            this.state = 328;
            this.match(CypherParser.BY);
            this.state = 330;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 39, this.context) ) {
            case 1:
                {
                this.state = 329;
                this.match(CypherParser.SP);
                }
                break;
            }
            this.state = 332;
            this.orderItem();
            this.state = 343;
            this.errorHandler.sync(this);
            alternative = this.interpreter.adaptivePredict(this.tokenStream, 42, this.context);
            while (alternative !== 2 && alternative !== antlr.ATN.INVALID_ALT_NUMBER) {
                if (alternative === 1) {
                    {
                    {
                    this.state = 334;
                    this.errorHandler.sync(this);
                    _la = this.tokenStream.LA(1);
                    if (_la === 99) {
                        {
                        this.state = 333;
                        this.match(CypherParser.SP);
                        }
                    }

                    this.state = 336;
                    this.match(CypherParser.COMMA);
                    this.state = 338;
                    this.errorHandler.sync(this);
                    switch (this.interpreter.adaptivePredict(this.tokenStream, 41, this.context) ) {
                    case 1:
                        {
                        this.state = 337;
                        this.match(CypherParser.SP);
                        }
                        break;
                    }
                    this.state = 340;
                    this.orderItem();
                    }
                    }
                }
                this.state = 345;
                this.errorHandler.sync(this);
                alternative = this.interpreter.adaptivePredict(this.tokenStream, 42, this.context);
            }
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public singlePartQ(): SinglePartQContext {
        let localContext = new SinglePartQContext(this.context, this.state);
        this.enterRule(localContext, 28, CypherParser.RULE_singlePartQ);
        let _la: number;
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 352;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            while (((((_la - 28)) & ~0x1F) === 0 && ((1 << (_la - 28)) & 2152202241) !== 0)) {
                {
                {
                this.state = 346;
                this.readingStatement();
                this.state = 348;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 347;
                    this.match(CypherParser.SP);
                    }
                }

                }
                }
                this.state = 354;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
            }
            this.state = 370;
            this.errorHandler.sync(this);
            switch (this.tokenStream.LA(1)) {
            case CypherParser.RETURN:
                {
                this.state = 355;
                this.returnSt();
                }
                break;
            case CypherParser.CREATE:
            case CypherParser.DELETE:
            case CypherParser.DETACH:
            case CypherParser.MERGE:
            case CypherParser.REMOVE:
            case CypherParser.SET:
                {
                this.state = 360;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                do {
                    {
                    {
                    this.state = 356;
                    this.updatingStatement();
                    this.state = 358;
                    this.errorHandler.sync(this);
                    switch (this.interpreter.adaptivePredict(this.tokenStream, 45, this.context) ) {
                    case 1:
                        {
                        this.state = 357;
                        this.match(CypherParser.SP);
                        }
                        break;
                    }
                    }
                    }
                    this.state = 362;
                    this.errorHandler.sync(this);
                    _la = this.tokenStream.LA(1);
                } while (((((_la - 40)) & ~0x1F) === 0 && ((1 << (_la - 40)) & 20755) !== 0));
                this.state = 368;
                this.errorHandler.sync(this);
                switch (this.interpreter.adaptivePredict(this.tokenStream, 48, this.context) ) {
                case 1:
                    {
                    this.state = 365;
                    this.errorHandler.sync(this);
                    _la = this.tokenStream.LA(1);
                    if (_la === 99) {
                        {
                        this.state = 364;
                        this.match(CypherParser.SP);
                        }
                    }

                    this.state = 367;
                    this.returnSt();
                    }
                    break;
                }
                }
                break;
            default:
                throw new antlr.NoViableAltException(this);
            }
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public multiPartQ(): MultiPartQContext {
        let localContext = new MultiPartQContext(this.context, this.state);
        this.enterRule(localContext, 30, CypherParser.RULE_multiPartQ);
        let _la: number;
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 378;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            while (((((_la - 28)) & ~0x1F) === 0 && ((1 << (_la - 28)) & 2152202241) !== 0)) {
                {
                {
                this.state = 372;
                this.readingStatement();
                this.state = 374;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 373;
                    this.match(CypherParser.SP);
                    }
                }

                }
                }
                this.state = 380;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
            }
            this.state = 387;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            while (((((_la - 40)) & ~0x1F) === 0 && ((1 << (_la - 40)) & 20755) !== 0)) {
                {
                {
                this.state = 381;
                this.updatingStatement();
                this.state = 383;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 382;
                    this.match(CypherParser.SP);
                    }
                }

                }
                }
                this.state = 389;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
            }
            this.state = 390;
            this.withSt();
            this.state = 392;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 391;
                this.match(CypherParser.SP);
                }
            }

            this.state = 394;
            this.singlePartQ();
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public matchSt(): MatchStContext {
        let localContext = new MatchStContext(this.context, this.state);
        this.enterRule(localContext, 32, CypherParser.RULE_matchSt);
        let _la: number;
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 398;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 50) {
                {
                this.state = 396;
                this.match(CypherParser.OPTIONAL);
                this.state = 397;
                this.match(CypherParser.SP);
                }
            }

            this.state = 400;
            this.match(CypherParser.MATCH);
            this.state = 402;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 401;
                this.match(CypherParser.SP);
                }
            }

            this.state = 404;
            this.patternWhere();
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public unwindSt(): UnwindStContext {
        let localContext = new UnwindStContext(this.context, this.state);
        this.enterRule(localContext, 34, CypherParser.RULE_unwindSt);
        let _la: number;
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 406;
            this.match(CypherParser.UNWIND);
            this.state = 408;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 57, this.context) ) {
            case 1:
                {
                this.state = 407;
                this.match(CypherParser.SP);
                }
                break;
            }
            this.state = 410;
            this.expression();
            this.state = 412;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 411;
                this.match(CypherParser.SP);
                }
            }

            this.state = 414;
            this.match(CypherParser.AS);
            this.state = 416;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 415;
                this.match(CypherParser.SP);
                }
            }

            this.state = 418;
            this.symbol_();
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public readingStatement(): ReadingStatementContext {
        let localContext = new ReadingStatementContext(this.context, this.state);
        this.enterRule(localContext, 36, CypherParser.RULE_readingStatement);
        try {
            this.state = 423;
            this.errorHandler.sync(this);
            switch (this.tokenStream.LA(1)) {
            case CypherParser.MATCH:
            case CypherParser.OPTIONAL:
                this.enterOuterAlt(localContext, 1);
                {
                this.state = 420;
                this.matchSt();
                }
                break;
            case CypherParser.UNWIND:
                this.enterOuterAlt(localContext, 2);
                {
                this.state = 421;
                this.unwindSt();
                }
                break;
            case CypherParser.CALL:
                this.enterOuterAlt(localContext, 3);
                {
                this.state = 422;
                this.queryCallSt();
                }
                break;
            default:
                throw new antlr.NoViableAltException(this);
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public updatingStatement(): UpdatingStatementContext {
        let localContext = new UpdatingStatementContext(this.context, this.state);
        this.enterRule(localContext, 38, CypherParser.RULE_updatingStatement);
        try {
            this.state = 430;
            this.errorHandler.sync(this);
            switch (this.tokenStream.LA(1)) {
            case CypherParser.CREATE:
                this.enterOuterAlt(localContext, 1);
                {
                this.state = 425;
                this.createSt();
                }
                break;
            case CypherParser.MERGE:
                this.enterOuterAlt(localContext, 2);
                {
                this.state = 426;
                this.mergeSt();
                }
                break;
            case CypherParser.DELETE:
            case CypherParser.DETACH:
                this.enterOuterAlt(localContext, 3);
                {
                this.state = 427;
                this.deleteSt();
                }
                break;
            case CypherParser.SET:
                this.enterOuterAlt(localContext, 4);
                {
                this.state = 428;
                this.setSt();
                }
                break;
            case CypherParser.REMOVE:
                this.enterOuterAlt(localContext, 5);
                {
                this.state = 429;
                this.removeSt();
                }
                break;
            default:
                throw new antlr.NoViableAltException(this);
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public deleteSt(): DeleteStContext {
        let localContext = new DeleteStContext(this.context, this.state);
        this.enterRule(localContext, 40, CypherParser.RULE_deleteSt);
        let _la: number;
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 434;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 44) {
                {
                this.state = 432;
                this.match(CypherParser.DETACH);
                this.state = 433;
                this.match(CypherParser.SP);
                }
            }

            this.state = 436;
            this.match(CypherParser.DELETE);
            this.state = 438;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 63, this.context) ) {
            case 1:
                {
                this.state = 437;
                this.match(CypherParser.SP);
                }
                break;
            }
            this.state = 440;
            this.expressionChain();
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public removeSt(): RemoveStContext {
        let localContext = new RemoveStContext(this.context, this.state);
        this.enterRule(localContext, 42, CypherParser.RULE_removeSt);
        let _la: number;
        try {
            let alternative: number;
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 442;
            this.match(CypherParser.REMOVE);
            this.state = 444;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 443;
                this.match(CypherParser.SP);
                }
            }

            this.state = 446;
            this.removeItem();
            this.state = 457;
            this.errorHandler.sync(this);
            alternative = this.interpreter.adaptivePredict(this.tokenStream, 67, this.context);
            while (alternative !== 2 && alternative !== antlr.ATN.INVALID_ALT_NUMBER) {
                if (alternative === 1) {
                    {
                    {
                    this.state = 448;
                    this.errorHandler.sync(this);
                    _la = this.tokenStream.LA(1);
                    if (_la === 99) {
                        {
                        this.state = 447;
                        this.match(CypherParser.SP);
                        }
                    }

                    this.state = 450;
                    this.match(CypherParser.COMMA);
                    this.state = 452;
                    this.errorHandler.sync(this);
                    _la = this.tokenStream.LA(1);
                    if (_la === 99) {
                        {
                        this.state = 451;
                        this.match(CypherParser.SP);
                        }
                    }

                    this.state = 454;
                    this.removeItem();
                    }
                    }
                }
                this.state = 459;
                this.errorHandler.sync(this);
                alternative = this.interpreter.adaptivePredict(this.tokenStream, 67, this.context);
            }
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public removeItem(): RemoveItemContext {
        let localContext = new RemoveItemContext(this.context, this.state);
        this.enterRule(localContext, 44, CypherParser.RULE_removeItem);
        let _la: number;
        try {
            this.state = 467;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 69, this.context) ) {
            case 1:
                this.enterOuterAlt(localContext, 1);
                {
                this.state = 460;
                this.symbol_();
                this.state = 462;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 461;
                    this.match(CypherParser.SP);
                    }
                }

                this.state = 464;
                this.nodeLabels();
                }
                break;
            case 2:
                this.enterOuterAlt(localContext, 2);
                {
                this.state = 466;
                this.propertyExpression();
                }
                break;
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public queryCallSt(): QueryCallStContext {
        let localContext = new QueryCallStContext(this.context, this.state);
        this.enterRule(localContext, 46, CypherParser.RULE_queryCallSt);
        let _la: number;
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 469;
            this.match(CypherParser.CALL);
            this.state = 471;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 470;
                this.match(CypherParser.SP);
                }
            }

            this.state = 473;
            this.invocationName();
            this.state = 475;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 474;
                this.match(CypherParser.SP);
                }
            }

            this.state = 477;
            this.parenExpressionChain();
            this.state = 486;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 74, this.context) ) {
            case 1:
                {
                this.state = 479;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 478;
                    this.match(CypherParser.SP);
                    }
                }

                this.state = 481;
                this.match(CypherParser.YIELD);
                this.state = 483;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 482;
                    this.match(CypherParser.SP);
                    }
                }

                this.state = 485;
                this.yieldItems();
                }
                break;
            }
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public parenExpressionChain(): ParenExpressionChainContext {
        let localContext = new ParenExpressionChainContext(this.context, this.state);
        this.enterRule(localContext, 48, CypherParser.RULE_parenExpressionChain);
        let _la: number;
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 488;
            this.match(CypherParser.LPAREN);
            this.state = 490;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 75, this.context) ) {
            case 1:
                {
                this.state = 489;
                this.match(CypherParser.SP);
                }
                break;
            }
            this.state = 493;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 76, this.context) ) {
            case 1:
                {
                this.state = 492;
                this.expressionChain();
                }
                break;
            }
            this.state = 496;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 495;
                this.match(CypherParser.SP);
                }
            }

            this.state = 498;
            this.match(CypherParser.RPAREN);
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public yieldItems(): YieldItemsContext {
        let localContext = new YieldItemsContext(this.context, this.state);
        this.enterRule(localContext, 50, CypherParser.RULE_yieldItems);
        let _la: number;
        try {
            let alternative: number;
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 500;
            this.yieldItem();
            this.state = 511;
            this.errorHandler.sync(this);
            alternative = this.interpreter.adaptivePredict(this.tokenStream, 80, this.context);
            while (alternative !== 2 && alternative !== antlr.ATN.INVALID_ALT_NUMBER) {
                if (alternative === 1) {
                    {
                    {
                    this.state = 502;
                    this.errorHandler.sync(this);
                    _la = this.tokenStream.LA(1);
                    if (_la === 99) {
                        {
                        this.state = 501;
                        this.match(CypherParser.SP);
                        }
                    }

                    this.state = 504;
                    this.match(CypherParser.COMMA);
                    this.state = 506;
                    this.errorHandler.sync(this);
                    _la = this.tokenStream.LA(1);
                    if (_la === 99) {
                        {
                        this.state = 505;
                        this.match(CypherParser.SP);
                        }
                    }

                    this.state = 508;
                    this.yieldItem();
                    }
                    }
                }
                this.state = 513;
                this.errorHandler.sync(this);
                alternative = this.interpreter.adaptivePredict(this.tokenStream, 80, this.context);
            }
            this.state = 518;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 82, this.context) ) {
            case 1:
                {
                this.state = 515;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 514;
                    this.match(CypherParser.SP);
                    }
                }

                this.state = 517;
                this.where();
                }
                break;
            }
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public yieldItem(): YieldItemContext {
        let localContext = new YieldItemContext(this.context, this.state);
        this.enterRule(localContext, 52, CypherParser.RULE_yieldItem);
        let _la: number;
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 528;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 85, this.context) ) {
            case 1:
                {
                this.state = 520;
                this.symbol_();
                this.state = 522;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 521;
                    this.match(CypherParser.SP);
                    }
                }

                this.state = 524;
                this.match(CypherParser.AS);
                this.state = 526;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 525;
                    this.match(CypherParser.SP);
                    }
                }

                }
                break;
            }
            this.state = 530;
            this.symbol_();
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public mergeSt(): MergeStContext {
        let localContext = new MergeStContext(this.context, this.state);
        this.enterRule(localContext, 54, CypherParser.RULE_mergeSt);
        let _la: number;
        try {
            let alternative: number;
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 532;
            this.match(CypherParser.MERGE);
            this.state = 534;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 533;
                this.match(CypherParser.SP);
                }
            }

            this.state = 536;
            this.patternPart();
            this.state = 543;
            this.errorHandler.sync(this);
            alternative = this.interpreter.adaptivePredict(this.tokenStream, 88, this.context);
            while (alternative !== 2 && alternative !== antlr.ATN.INVALID_ALT_NUMBER) {
                if (alternative === 1) {
                    {
                    {
                    this.state = 538;
                    this.errorHandler.sync(this);
                    _la = this.tokenStream.LA(1);
                    if (_la === 99) {
                        {
                        this.state = 537;
                        this.match(CypherParser.SP);
                        }
                    }

                    this.state = 540;
                    this.mergeAction();
                    }
                    }
                }
                this.state = 545;
                this.errorHandler.sync(this);
                alternative = this.interpreter.adaptivePredict(this.tokenStream, 88, this.context);
            }
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public mergeAction(): MergeActionContext {
        let localContext = new MergeActionContext(this.context, this.state);
        this.enterRule(localContext, 56, CypherParser.RULE_mergeAction);
        let _la: number;
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 546;
            this.match(CypherParser.ON);
            this.state = 548;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 547;
                this.match(CypherParser.SP);
                }
            }

            this.state = 550;
            _la = this.tokenStream.LA(1);
            if(!(_la === 40 || _la === 47)) {
            this.errorHandler.recoverInline(this);
            }
            else {
                this.errorHandler.reportMatch(this);
                this.consume();
            }
            this.state = 552;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 551;
                this.match(CypherParser.SP);
                }
            }

            this.state = 554;
            this.setSt();
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public setSt(): SetStContext {
        let localContext = new SetStContext(this.context, this.state);
        this.enterRule(localContext, 58, CypherParser.RULE_setSt);
        let _la: number;
        try {
            let alternative: number;
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 556;
            this.match(CypherParser.SET);
            this.state = 558;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 557;
                this.match(CypherParser.SP);
                }
            }

            this.state = 560;
            this.setItem();
            this.state = 571;
            this.errorHandler.sync(this);
            alternative = this.interpreter.adaptivePredict(this.tokenStream, 94, this.context);
            while (alternative !== 2 && alternative !== antlr.ATN.INVALID_ALT_NUMBER) {
                if (alternative === 1) {
                    {
                    {
                    this.state = 562;
                    this.errorHandler.sync(this);
                    _la = this.tokenStream.LA(1);
                    if (_la === 99) {
                        {
                        this.state = 561;
                        this.match(CypherParser.SP);
                        }
                    }

                    this.state = 564;
                    this.match(CypherParser.COMMA);
                    this.state = 566;
                    this.errorHandler.sync(this);
                    _la = this.tokenStream.LA(1);
                    if (_la === 99) {
                        {
                        this.state = 565;
                        this.match(CypherParser.SP);
                        }
                    }

                    this.state = 568;
                    this.setItem();
                    }
                    }
                }
                this.state = 573;
                this.errorHandler.sync(this);
                alternative = this.interpreter.adaptivePredict(this.tokenStream, 94, this.context);
            }
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public setItem(): SetItemContext {
        let localContext = new SetItemContext(this.context, this.state);
        this.enterRule(localContext, 60, CypherParser.RULE_setItem);
        let _la: number;
        try {
            this.state = 600;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 100, this.context) ) {
            case 1:
                this.enterOuterAlt(localContext, 1);
                {
                this.state = 574;
                this.propertyExpression();
                this.state = 576;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 575;
                    this.match(CypherParser.SP);
                    }
                }

                this.state = 578;
                this.match(CypherParser.ASSIGN);
                this.state = 580;
                this.errorHandler.sync(this);
                switch (this.interpreter.adaptivePredict(this.tokenStream, 96, this.context) ) {
                case 1:
                    {
                    this.state = 579;
                    this.match(CypherParser.SP);
                    }
                    break;
                }
                this.state = 582;
                this.expression();
                }
                break;
            case 2:
                this.enterOuterAlt(localContext, 2);
                {
                this.state = 584;
                this.symbol_();
                this.state = 586;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 585;
                    this.match(CypherParser.SP);
                    }
                }

                this.state = 588;
                _la = this.tokenStream.LA(1);
                if(!(_la === 1 || _la === 2)) {
                this.errorHandler.recoverInline(this);
                }
                else {
                    this.errorHandler.reportMatch(this);
                    this.consume();
                }
                this.state = 590;
                this.errorHandler.sync(this);
                switch (this.interpreter.adaptivePredict(this.tokenStream, 98, this.context) ) {
                case 1:
                    {
                    this.state = 589;
                    this.match(CypherParser.SP);
                    }
                    break;
                }
                this.state = 592;
                this.expression();
                }
                break;
            case 3:
                this.enterOuterAlt(localContext, 3);
                {
                this.state = 594;
                this.symbol_();
                this.state = 596;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 595;
                    this.match(CypherParser.SP);
                    }
                }

                this.state = 598;
                this.nodeLabels();
                }
                break;
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public nodeLabels(): NodeLabelsContext {
        let localContext = new NodeLabelsContext(this.context, this.state);
        this.enterRule(localContext, 62, CypherParser.RULE_nodeLabels);
        let _la: number;
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 607;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            do {
                {
                {
                this.state = 602;
                this.match(CypherParser.COLON);
                this.state = 604;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 603;
                    this.match(CypherParser.SP);
                    }
                }

                this.state = 606;
                this.name();
                }
                }
                this.state = 609;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
            } while (_la === 25);
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public createSt(): CreateStContext {
        let localContext = new CreateStContext(this.context, this.state);
        this.enterRule(localContext, 64, CypherParser.RULE_createSt);
        let _la: number;
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 611;
            this.match(CypherParser.CREATE);
            this.state = 613;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 612;
                this.match(CypherParser.SP);
                }
            }

            this.state = 615;
            this.pattern();
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public patternWhere(): PatternWhereContext {
        let localContext = new PatternWhereContext(this.context, this.state);
        this.enterRule(localContext, 66, CypherParser.RULE_patternWhere);
        let _la: number;
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 617;
            this.pattern();
            this.state = 622;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 105, this.context) ) {
            case 1:
                {
                this.state = 619;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 618;
                    this.match(CypherParser.SP);
                    }
                }

                this.state = 621;
                this.where();
                }
                break;
            }
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public where(): WhereContext {
        let localContext = new WhereContext(this.context, this.state);
        this.enterRule(localContext, 68, CypherParser.RULE_where);
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 624;
            this.match(CypherParser.WHERE);
            this.state = 626;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 106, this.context) ) {
            case 1:
                {
                this.state = 625;
                this.match(CypherParser.SP);
                }
                break;
            }
            this.state = 628;
            this.expression();
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public pattern(): PatternContext {
        let localContext = new PatternContext(this.context, this.state);
        this.enterRule(localContext, 70, CypherParser.RULE_pattern);
        let _la: number;
        try {
            let alternative: number;
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 630;
            this.patternPart();
            this.state = 641;
            this.errorHandler.sync(this);
            alternative = this.interpreter.adaptivePredict(this.tokenStream, 109, this.context);
            while (alternative !== 2 && alternative !== antlr.ATN.INVALID_ALT_NUMBER) {
                if (alternative === 1) {
                    {
                    {
                    this.state = 632;
                    this.errorHandler.sync(this);
                    _la = this.tokenStream.LA(1);
                    if (_la === 99) {
                        {
                        this.state = 631;
                        this.match(CypherParser.SP);
                        }
                    }

                    this.state = 634;
                    this.match(CypherParser.COMMA);
                    this.state = 636;
                    this.errorHandler.sync(this);
                    _la = this.tokenStream.LA(1);
                    if (_la === 99) {
                        {
                        this.state = 635;
                        this.match(CypherParser.SP);
                        }
                    }

                    this.state = 638;
                    this.patternPart();
                    }
                    }
                }
                this.state = 643;
                this.errorHandler.sync(this);
                alternative = this.interpreter.adaptivePredict(this.tokenStream, 109, this.context);
            }
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public expression(): ExpressionContext {
        let localContext = new ExpressionContext(this.context, this.state);
        this.enterRule(localContext, 72, CypherParser.RULE_expression);
        let _la: number;
        try {
            let alternative: number;
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 644;
            this.xorExpression();
            this.state = 655;
            this.errorHandler.sync(this);
            alternative = this.interpreter.adaptivePredict(this.tokenStream, 112, this.context);
            while (alternative !== 2 && alternative !== antlr.ATN.INVALID_ALT_NUMBER) {
                if (alternative === 1) {
                    {
                    {
                    this.state = 646;
                    this.errorHandler.sync(this);
                    _la = this.tokenStream.LA(1);
                    if (_la === 99) {
                        {
                        this.state = 645;
                        this.match(CypherParser.SP);
                        }
                    }

                    this.state = 648;
                    this.match(CypherParser.OR);
                    this.state = 650;
                    this.errorHandler.sync(this);
                    switch (this.interpreter.adaptivePredict(this.tokenStream, 111, this.context) ) {
                    case 1:
                        {
                        this.state = 649;
                        this.match(CypherParser.SP);
                        }
                        break;
                    }
                    this.state = 652;
                    this.xorExpression();
                    }
                    }
                }
                this.state = 657;
                this.errorHandler.sync(this);
                alternative = this.interpreter.adaptivePredict(this.tokenStream, 112, this.context);
            }
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public xorExpression(): XorExpressionContext {
        let localContext = new XorExpressionContext(this.context, this.state);
        this.enterRule(localContext, 74, CypherParser.RULE_xorExpression);
        let _la: number;
        try {
            let alternative: number;
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 658;
            this.andExpression();
            this.state = 669;
            this.errorHandler.sync(this);
            alternative = this.interpreter.adaptivePredict(this.tokenStream, 115, this.context);
            while (alternative !== 2 && alternative !== antlr.ATN.INVALID_ALT_NUMBER) {
                if (alternative === 1) {
                    {
                    {
                    this.state = 660;
                    this.errorHandler.sync(this);
                    _la = this.tokenStream.LA(1);
                    if (_la === 99) {
                        {
                        this.state = 659;
                        this.match(CypherParser.SP);
                        }
                    }

                    this.state = 662;
                    this.match(CypherParser.XOR);
                    this.state = 664;
                    this.errorHandler.sync(this);
                    switch (this.interpreter.adaptivePredict(this.tokenStream, 114, this.context) ) {
                    case 1:
                        {
                        this.state = 663;
                        this.match(CypherParser.SP);
                        }
                        break;
                    }
                    this.state = 666;
                    this.andExpression();
                    }
                    }
                }
                this.state = 671;
                this.errorHandler.sync(this);
                alternative = this.interpreter.adaptivePredict(this.tokenStream, 115, this.context);
            }
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public andExpression(): AndExpressionContext {
        let localContext = new AndExpressionContext(this.context, this.state);
        this.enterRule(localContext, 76, CypherParser.RULE_andExpression);
        let _la: number;
        try {
            let alternative: number;
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 672;
            this.notExpression();
            this.state = 683;
            this.errorHandler.sync(this);
            alternative = this.interpreter.adaptivePredict(this.tokenStream, 118, this.context);
            while (alternative !== 2 && alternative !== antlr.ATN.INVALID_ALT_NUMBER) {
                if (alternative === 1) {
                    {
                    {
                    this.state = 674;
                    this.errorHandler.sync(this);
                    _la = this.tokenStream.LA(1);
                    if (_la === 99) {
                        {
                        this.state = 673;
                        this.match(CypherParser.SP);
                        }
                    }

                    this.state = 676;
                    this.match(CypherParser.AND);
                    this.state = 678;
                    this.errorHandler.sync(this);
                    switch (this.interpreter.adaptivePredict(this.tokenStream, 117, this.context) ) {
                    case 1:
                        {
                        this.state = 677;
                        this.match(CypherParser.SP);
                        }
                        break;
                    }
                    this.state = 680;
                    this.notExpression();
                    }
                    }
                }
                this.state = 685;
                this.errorHandler.sync(this);
                alternative = this.interpreter.adaptivePredict(this.tokenStream, 118, this.context);
            }
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public notExpression(): NotExpressionContext {
        let localContext = new NotExpressionContext(this.context, this.state);
        this.enterRule(localContext, 78, CypherParser.RULE_notExpression);
        let _la: number;
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 692;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            while (_la === 67) {
                {
                {
                this.state = 686;
                this.match(CypherParser.NOT);
                this.state = 688;
                this.errorHandler.sync(this);
                switch (this.interpreter.adaptivePredict(this.tokenStream, 119, this.context) ) {
                case 1:
                    {
                    this.state = 687;
                    this.match(CypherParser.SP);
                    }
                    break;
                }
                }
                }
                this.state = 694;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
            }
            this.state = 695;
            this.comparisonExpression();
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public comparisonExpression(): ComparisonExpressionContext {
        let localContext = new ComparisonExpressionContext(this.context, this.state);
        this.enterRule(localContext, 80, CypherParser.RULE_comparisonExpression);
        let _la: number;
        try {
            let alternative: number;
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 697;
            this.addSubExpression();
            this.state = 709;
            this.errorHandler.sync(this);
            alternative = this.interpreter.adaptivePredict(this.tokenStream, 123, this.context);
            while (alternative !== 2 && alternative !== antlr.ATN.INVALID_ALT_NUMBER) {
                if (alternative === 1) {
                    {
                    {
                    this.state = 699;
                    this.errorHandler.sync(this);
                    _la = this.tokenStream.LA(1);
                    if (_la === 99) {
                        {
                        this.state = 698;
                        this.match(CypherParser.SP);
                        }
                    }

                    this.state = 701;
                    this.comparisonSigns();
                    this.state = 703;
                    this.errorHandler.sync(this);
                    switch (this.interpreter.adaptivePredict(this.tokenStream, 122, this.context) ) {
                    case 1:
                        {
                        this.state = 702;
                        this.match(CypherParser.SP);
                        }
                        break;
                    }
                    this.state = 705;
                    this.addSubExpression();
                    }
                    }
                }
                this.state = 711;
                this.errorHandler.sync(this);
                alternative = this.interpreter.adaptivePredict(this.tokenStream, 123, this.context);
            }
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public comparisonSigns(): ComparisonSignsContext {
        let localContext = new ComparisonSignsContext(this.context, this.state);
        this.enterRule(localContext, 82, CypherParser.RULE_comparisonSigns);
        let _la: number;
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 712;
            _la = this.tokenStream.LA(1);
            if(!((((_la) & ~0x1F) === 0 && ((1 << _la) & 250) !== 0))) {
            this.errorHandler.recoverInline(this);
            }
            else {
                this.errorHandler.reportMatch(this);
                this.consume();
            }
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public addSubExpression(): AddSubExpressionContext {
        let localContext = new AddSubExpressionContext(this.context, this.state);
        this.enterRule(localContext, 84, CypherParser.RULE_addSubExpression);
        let _la: number;
        try {
            let alternative: number;
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 714;
            this.multDivExpression();
            this.state = 725;
            this.errorHandler.sync(this);
            alternative = this.interpreter.adaptivePredict(this.tokenStream, 126, this.context);
            while (alternative !== 2 && alternative !== antlr.ATN.INVALID_ALT_NUMBER) {
                if (alternative === 1) {
                    {
                    {
                    this.state = 716;
                    this.errorHandler.sync(this);
                    _la = this.tokenStream.LA(1);
                    if (_la === 99) {
                        {
                        this.state = 715;
                        this.match(CypherParser.SP);
                        }
                    }

                    this.state = 718;
                    _la = this.tokenStream.LA(1);
                    if(!(_la === 18 || _la === 19)) {
                    this.errorHandler.recoverInline(this);
                    }
                    else {
                        this.errorHandler.reportMatch(this);
                        this.consume();
                    }
                    this.state = 720;
                    this.errorHandler.sync(this);
                    switch (this.interpreter.adaptivePredict(this.tokenStream, 125, this.context) ) {
                    case 1:
                        {
                        this.state = 719;
                        this.match(CypherParser.SP);
                        }
                        break;
                    }
                    this.state = 722;
                    this.multDivExpression();
                    }
                    }
                }
                this.state = 727;
                this.errorHandler.sync(this);
                alternative = this.interpreter.adaptivePredict(this.tokenStream, 126, this.context);
            }
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public multDivExpression(): MultDivExpressionContext {
        let localContext = new MultDivExpressionContext(this.context, this.state);
        this.enterRule(localContext, 86, CypherParser.RULE_multDivExpression);
        let _la: number;
        try {
            let alternative: number;
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 728;
            this.powerExpression();
            this.state = 739;
            this.errorHandler.sync(this);
            alternative = this.interpreter.adaptivePredict(this.tokenStream, 129, this.context);
            while (alternative !== 2 && alternative !== antlr.ATN.INVALID_ALT_NUMBER) {
                if (alternative === 1) {
                    {
                    {
                    this.state = 730;
                    this.errorHandler.sync(this);
                    _la = this.tokenStream.LA(1);
                    if (_la === 99) {
                        {
                        this.state = 729;
                        this.match(CypherParser.SP);
                        }
                    }

                    this.state = 732;
                    _la = this.tokenStream.LA(1);
                    if(!((((_la) & ~0x1F) === 0 && ((1 << _la) & 11534336) !== 0))) {
                    this.errorHandler.recoverInline(this);
                    }
                    else {
                        this.errorHandler.reportMatch(this);
                        this.consume();
                    }
                    this.state = 734;
                    this.errorHandler.sync(this);
                    switch (this.interpreter.adaptivePredict(this.tokenStream, 128, this.context) ) {
                    case 1:
                        {
                        this.state = 733;
                        this.match(CypherParser.SP);
                        }
                        break;
                    }
                    this.state = 736;
                    this.powerExpression();
                    }
                    }
                }
                this.state = 741;
                this.errorHandler.sync(this);
                alternative = this.interpreter.adaptivePredict(this.tokenStream, 129, this.context);
            }
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public powerExpression(): PowerExpressionContext {
        let localContext = new PowerExpressionContext(this.context, this.state);
        this.enterRule(localContext, 88, CypherParser.RULE_powerExpression);
        let _la: number;
        try {
            let alternative: number;
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 742;
            this.unaryAddSubExpression();
            this.state = 753;
            this.errorHandler.sync(this);
            alternative = this.interpreter.adaptivePredict(this.tokenStream, 132, this.context);
            while (alternative !== 2 && alternative !== antlr.ATN.INVALID_ALT_NUMBER) {
                if (alternative === 1) {
                    {
                    {
                    this.state = 744;
                    this.errorHandler.sync(this);
                    _la = this.tokenStream.LA(1);
                    if (_la === 99) {
                        {
                        this.state = 743;
                        this.match(CypherParser.SP);
                        }
                    }

                    this.state = 746;
                    this.match(CypherParser.CARET);
                    this.state = 748;
                    this.errorHandler.sync(this);
                    switch (this.interpreter.adaptivePredict(this.tokenStream, 131, this.context) ) {
                    case 1:
                        {
                        this.state = 747;
                        this.match(CypherParser.SP);
                        }
                        break;
                    }
                    this.state = 750;
                    this.unaryAddSubExpression();
                    }
                    }
                }
                this.state = 755;
                this.errorHandler.sync(this);
                alternative = this.interpreter.adaptivePredict(this.tokenStream, 132, this.context);
            }
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public unaryAddSubExpression(): UnaryAddSubExpressionContext {
        let localContext = new UnaryAddSubExpressionContext(this.context, this.state);
        this.enterRule(localContext, 90, CypherParser.RULE_unaryAddSubExpression);
        let _la: number;
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 757;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 18 || _la === 19) {
                {
                this.state = 756;
                _la = this.tokenStream.LA(1);
                if(!(_la === 18 || _la === 19)) {
                this.errorHandler.recoverInline(this);
                }
                else {
                    this.errorHandler.reportMatch(this);
                    this.consume();
                }
                }
            }

            this.state = 760;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 759;
                this.match(CypherParser.SP);
                }
            }

            this.state = 762;
            this.atomicExpression();
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public atomicExpression(): AtomicExpressionContext {
        let localContext = new AtomicExpressionContext(this.context, this.state);
        this.enterRule(localContext, 92, CypherParser.RULE_atomicExpression);
        try {
            let alternative: number;
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 764;
            this.propertyOrLabelExpression();
            this.state = 775;
            this.errorHandler.sync(this);
            alternative = this.interpreter.adaptivePredict(this.tokenStream, 137, this.context);
            while (alternative !== 2 && alternative !== antlr.ATN.INVALID_ALT_NUMBER) {
                if (alternative === 1) {
                    {
                    {
                    this.state = 766;
                    this.errorHandler.sync(this);
                    switch (this.interpreter.adaptivePredict(this.tokenStream, 135, this.context) ) {
                    case 1:
                        {
                        this.state = 765;
                        this.match(CypherParser.SP);
                        }
                        break;
                    }
                    this.state = 771;
                    this.errorHandler.sync(this);
                    switch (this.interpreter.adaptivePredict(this.tokenStream, 136, this.context) ) {
                    case 1:
                        {
                        this.state = 768;
                        this.stringExpression();
                        }
                        break;
                    case 2:
                        {
                        this.state = 769;
                        this.listExpression();
                        }
                        break;
                    case 3:
                        {
                        this.state = 770;
                        this.nullExpression();
                        }
                        break;
                    }
                    }
                    }
                }
                this.state = 777;
                this.errorHandler.sync(this);
                alternative = this.interpreter.adaptivePredict(this.tokenStream, 137, this.context);
            }
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public listExpression(): ListExpressionContext {
        let localContext = new ListExpressionContext(this.context, this.state);
        this.enterRule(localContext, 94, CypherParser.RULE_listExpression);
        let _la: number;
        try {
            this.state = 810;
            this.errorHandler.sync(this);
            switch (this.tokenStream.LA(1)) {
            case CypherParser.IN:
            case CypherParser.SP:
                this.enterOuterAlt(localContext, 1);
                {
                this.state = 779;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 778;
                    this.match(CypherParser.SP);
                    }
                }

                this.state = 781;
                this.match(CypherParser.IN);
                this.state = 783;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 782;
                    this.match(CypherParser.SP);
                    }
                }

                this.state = 785;
                this.propertyOrLabelExpression();
                }
                break;
            case CypherParser.LBRACK:
                this.enterOuterAlt(localContext, 2);
                {
                this.state = 786;
                this.match(CypherParser.LBRACK);
                this.state = 788;
                this.errorHandler.sync(this);
                switch (this.interpreter.adaptivePredict(this.tokenStream, 140, this.context) ) {
                case 1:
                    {
                    this.state = 787;
                    this.match(CypherParser.SP);
                    }
                    break;
                }
                this.state = 804;
                this.errorHandler.sync(this);
                switch (this.interpreter.adaptivePredict(this.tokenStream, 145, this.context) ) {
                case 1:
                    {
                    this.state = 791;
                    this.errorHandler.sync(this);
                    switch (this.interpreter.adaptivePredict(this.tokenStream, 141, this.context) ) {
                    case 1:
                        {
                        this.state = 790;
                        this.expression();
                        }
                        break;
                    }
                    this.state = 794;
                    this.errorHandler.sync(this);
                    _la = this.tokenStream.LA(1);
                    if (_la === 99) {
                        {
                        this.state = 793;
                        this.match(CypherParser.SP);
                        }
                    }

                    this.state = 796;
                    this.match(CypherParser.RANGE);
                    this.state = 798;
                    this.errorHandler.sync(this);
                    switch (this.interpreter.adaptivePredict(this.tokenStream, 143, this.context) ) {
                    case 1:
                        {
                        this.state = 797;
                        this.match(CypherParser.SP);
                        }
                        break;
                    }
                    this.state = 801;
                    this.errorHandler.sync(this);
                    switch (this.interpreter.adaptivePredict(this.tokenStream, 144, this.context) ) {
                    case 1:
                        {
                        this.state = 800;
                        this.expression();
                        }
                        break;
                    }
                    }
                    break;
                case 2:
                    {
                    this.state = 803;
                    this.expression();
                    }
                    break;
                }
                this.state = 807;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 806;
                    this.match(CypherParser.SP);
                    }
                }

                this.state = 809;
                this.match(CypherParser.RBRACK);
                }
                break;
            default:
                throw new antlr.NoViableAltException(this);
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public stringExpression(): StringExpressionContext {
        let localContext = new StringExpressionContext(this.context, this.state);
        this.enterRule(localContext, 96, CypherParser.RULE_stringExpression);
        let _la: number;
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 812;
            this.stringExpPrefix();
            this.state = 814;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 813;
                this.match(CypherParser.SP);
                }
            }

            this.state = 816;
            this.propertyOrLabelExpression();
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public stringExpPrefix(): StringExpPrefixContext {
        let localContext = new StringExpPrefixContext(this.context, this.state);
        this.enterRule(localContext, 98, CypherParser.RULE_stringExpPrefix);
        let _la: number;
        try {
            this.state = 829;
            this.errorHandler.sync(this);
            switch (this.tokenStream.LA(1)) {
            case CypherParser.STARTS:
                this.enterOuterAlt(localContext, 1);
                {
                this.state = 818;
                this.match(CypherParser.STARTS);
                this.state = 820;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 819;
                    this.match(CypherParser.SP);
                    }
                }

                this.state = 822;
                this.match(CypherParser.WITH);
                }
                break;
            case CypherParser.ENDS:
                this.enterOuterAlt(localContext, 2);
                {
                this.state = 823;
                this.match(CypherParser.ENDS);
                this.state = 825;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 824;
                    this.match(CypherParser.SP);
                    }
                }

                this.state = 827;
                this.match(CypherParser.WITH);
                }
                break;
            case CypherParser.CONTAINS:
                this.enterOuterAlt(localContext, 3);
                {
                this.state = 828;
                this.match(CypherParser.CONTAINS);
                }
                break;
            default:
                throw new antlr.NoViableAltException(this);
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public nullExpression(): NullExpressionContext {
        let localContext = new NullExpressionContext(this.context, this.state);
        this.enterRule(localContext, 100, CypherParser.RULE_nullExpression);
        let _la: number;
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 832;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 831;
                this.match(CypherParser.SP);
                }
            }

            this.state = 834;
            this.match(CypherParser.IS);
            this.state = 836;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 153, this.context) ) {
            case 1:
                {
                this.state = 835;
                this.match(CypherParser.SP);
                }
                break;
            }
            this.state = 839;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 67) {
                {
                this.state = 838;
                this.match(CypherParser.NOT);
                }
            }

            this.state = 842;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 841;
                this.match(CypherParser.SP);
                }
            }

            this.state = 844;
            this.match(CypherParser.NULL_W);
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public propertyOrLabelExpression(): PropertyOrLabelExpressionContext {
        let localContext = new PropertyOrLabelExpressionContext(this.context, this.state);
        this.enterRule(localContext, 102, CypherParser.RULE_propertyOrLabelExpression);
        let _la: number;
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 846;
            this.propertyExpression();
            this.state = 851;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 157, this.context) ) {
            case 1:
                {
                this.state = 848;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 847;
                    this.match(CypherParser.SP);
                    }
                }

                this.state = 850;
                this.nodeLabels();
                }
                break;
            }
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public propertyExpression(): PropertyExpressionContext {
        let localContext = new PropertyExpressionContext(this.context, this.state);
        this.enterRule(localContext, 104, CypherParser.RULE_propertyExpression);
        let _la: number;
        try {
            let alternative: number;
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 853;
            this.atom();
            this.state = 864;
            this.errorHandler.sync(this);
            alternative = this.interpreter.adaptivePredict(this.tokenStream, 160, this.context);
            while (alternative !== 2 && alternative !== antlr.ATN.INVALID_ALT_NUMBER) {
                if (alternative === 1) {
                    {
                    {
                    this.state = 855;
                    this.errorHandler.sync(this);
                    _la = this.tokenStream.LA(1);
                    if (_la === 99) {
                        {
                        this.state = 854;
                        this.match(CypherParser.SP);
                        }
                    }

                    this.state = 857;
                    this.match(CypherParser.DOT);
                    this.state = 859;
                    this.errorHandler.sync(this);
                    _la = this.tokenStream.LA(1);
                    if (_la === 99) {
                        {
                        this.state = 858;
                        this.match(CypherParser.SP);
                        }
                    }

                    this.state = 861;
                    this.name();
                    }
                    }
                }
                this.state = 866;
                this.errorHandler.sync(this);
                alternative = this.interpreter.adaptivePredict(this.tokenStream, 160, this.context);
            }
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public patternPart(): PatternPartContext {
        let localContext = new PatternPartContext(this.context, this.state);
        this.enterRule(localContext, 106, CypherParser.RULE_patternPart);
        let _la: number;
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 875;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 163, this.context) ) {
            case 1:
                {
                this.state = 867;
                this.symbol_();
                this.state = 869;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 868;
                    this.match(CypherParser.SP);
                    }
                }

                this.state = 871;
                this.match(CypherParser.ASSIGN);
                this.state = 873;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 872;
                    this.match(CypherParser.SP);
                    }
                }

                }
                break;
            }
            this.state = 877;
            this.patternElem();
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public patternElem(): PatternElemContext {
        let localContext = new PatternElemContext(this.context, this.state);
        this.enterRule(localContext, 108, CypherParser.RULE_patternElem);
        let _la: number;
        try {
            let alternative: number;
            this.state = 900;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 168, this.context) ) {
            case 1:
                this.enterOuterAlt(localContext, 1);
                {
                this.state = 879;
                this.nodePattern();
                this.state = 886;
                this.errorHandler.sync(this);
                alternative = this.interpreter.adaptivePredict(this.tokenStream, 165, this.context);
                while (alternative !== 2 && alternative !== antlr.ATN.INVALID_ALT_NUMBER) {
                    if (alternative === 1) {
                        {
                        {
                        this.state = 881;
                        this.errorHandler.sync(this);
                        _la = this.tokenStream.LA(1);
                        if (_la === 99) {
                            {
                            this.state = 880;
                            this.match(CypherParser.SP);
                            }
                        }

                        this.state = 883;
                        this.patternElemChain();
                        }
                        }
                    }
                    this.state = 888;
                    this.errorHandler.sync(this);
                    alternative = this.interpreter.adaptivePredict(this.tokenStream, 165, this.context);
                }
                }
                break;
            case 2:
                this.enterOuterAlt(localContext, 2);
                {
                this.state = 889;
                this.match(CypherParser.LPAREN);
                this.state = 891;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 890;
                    this.match(CypherParser.SP);
                    }
                }

                this.state = 893;
                this.patternElem();
                this.state = 895;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 894;
                    this.match(CypherParser.SP);
                    }
                }

                this.state = 897;
                this.match(CypherParser.RPAREN);
                }
                break;
            case 3:
                this.enterOuterAlt(localContext, 3);
                {
                this.state = 899;
                this.functionInvocation();
                }
                break;
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public patternElemChain(): PatternElemChainContext {
        let localContext = new PatternElemChainContext(this.context, this.state);
        this.enterRule(localContext, 110, CypherParser.RULE_patternElemChain);
        let _la: number;
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 902;
            this.relationshipPattern();
            this.state = 904;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 903;
                this.match(CypherParser.SP);
                }
            }

            this.state = 906;
            this.nodePattern();
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public properties(): PropertiesContext {
        let localContext = new PropertiesContext(this.context, this.state);
        this.enterRule(localContext, 112, CypherParser.RULE_properties);
        try {
            this.state = 910;
            this.errorHandler.sync(this);
            switch (this.tokenStream.LA(1)) {
            case CypherParser.LBRACE:
                this.enterOuterAlt(localContext, 1);
                {
                this.state = 908;
                this.mapLit();
                }
                break;
            case CypherParser.DOLLAR:
                this.enterOuterAlt(localContext, 2);
                {
                this.state = 909;
                this.parameter();
                }
                break;
            default:
                throw new antlr.NoViableAltException(this);
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public nodePattern(): NodePatternContext {
        let localContext = new NodePatternContext(this.context, this.state);
        this.enterRule(localContext, 114, CypherParser.RULE_nodePattern);
        let _la: number;
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 912;
            this.match(CypherParser.LPAREN);
            this.state = 914;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 171, this.context) ) {
            case 1:
                {
                this.state = 913;
                this.match(CypherParser.SP);
                }
                break;
            }
            this.state = 917;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (((((_la - 30)) & ~0x1F) === 0 && ((1 << (_la - 30)) & 63) !== 0) || ((((_la - 89)) & ~0x1F) === 0 && ((1 << (_la - 89)) & 89) !== 0)) {
                {
                this.state = 916;
                this.symbol_();
                }
            }

            this.state = 920;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 173, this.context) ) {
            case 1:
                {
                this.state = 919;
                this.match(CypherParser.SP);
                }
                break;
            }
            this.state = 923;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 25) {
                {
                this.state = 922;
                this.nodeLabels();
                }
            }

            this.state = 926;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 175, this.context) ) {
            case 1:
                {
                this.state = 925;
                this.match(CypherParser.SP);
                }
                break;
            }
            this.state = 929;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 14 || _la === 27) {
                {
                this.state = 928;
                this.properties();
                }
            }

            this.state = 932;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 931;
                this.match(CypherParser.SP);
                }
            }

            this.state = 934;
            this.match(CypherParser.RPAREN);
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public atom(): AtomContext {
        let localContext = new AtomContext(this.context, this.state);
        this.enterRule(localContext, 116, CypherParser.RULE_atom);
        try {
            this.state = 948;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 178, this.context) ) {
            case 1:
                this.enterOuterAlt(localContext, 1);
                {
                this.state = 936;
                this.literal();
                }
                break;
            case 2:
                this.enterOuterAlt(localContext, 2);
                {
                this.state = 937;
                this.parameter();
                }
                break;
            case 3:
                this.enterOuterAlt(localContext, 3);
                {
                this.state = 938;
                this.caseExpression();
                }
                break;
            case 4:
                this.enterOuterAlt(localContext, 4);
                {
                this.state = 939;
                this.countAll();
                }
                break;
            case 5:
                this.enterOuterAlt(localContext, 5);
                {
                this.state = 940;
                this.listComprehension();
                }
                break;
            case 6:
                this.enterOuterAlt(localContext, 6);
                {
                this.state = 941;
                this.patternComprehension();
                }
                break;
            case 7:
                this.enterOuterAlt(localContext, 7);
                {
                this.state = 942;
                this.filterWith();
                }
                break;
            case 8:
                this.enterOuterAlt(localContext, 8);
                {
                this.state = 943;
                this.relationshipsChainPattern();
                }
                break;
            case 9:
                this.enterOuterAlt(localContext, 9);
                {
                this.state = 944;
                this.parenthesizedExpression();
                }
                break;
            case 10:
                this.enterOuterAlt(localContext, 10);
                {
                this.state = 945;
                this.functionInvocation();
                }
                break;
            case 11:
                this.enterOuterAlt(localContext, 11);
                {
                this.state = 946;
                this.symbol_();
                }
                break;
            case 12:
                this.enterOuterAlt(localContext, 12);
                {
                this.state = 947;
                this.subqueryExist();
                }
                break;
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public lhs(): LhsContext {
        let localContext = new LhsContext(this.context, this.state);
        this.enterRule(localContext, 118, CypherParser.RULE_lhs);
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 950;
            this.symbol_();
            this.state = 951;
            this.match(CypherParser.ASSIGN);
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public relationshipPattern(): RelationshipPatternContext {
        let localContext = new RelationshipPatternContext(this.context, this.state);
        this.enterRule(localContext, 120, CypherParser.RULE_relationshipPattern);
        let _la: number;
        try {
            this.state = 991;
            this.errorHandler.sync(this);
            switch (this.tokenStream.LA(1)) {
            case CypherParser.LT:
                this.enterOuterAlt(localContext, 1);
                {
                this.state = 953;
                this.match(CypherParser.LT);
                this.state = 955;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 954;
                    this.match(CypherParser.SP);
                    }
                }

                this.state = 957;
                this.match(CypherParser.SUB);
                this.state = 959;
                this.errorHandler.sync(this);
                switch (this.interpreter.adaptivePredict(this.tokenStream, 180, this.context) ) {
                case 1:
                    {
                    this.state = 958;
                    this.match(CypherParser.SP);
                    }
                    break;
                }
                this.state = 962;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 16) {
                    {
                    this.state = 961;
                    this.relationDetail();
                    }
                }

                this.state = 965;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 964;
                    this.match(CypherParser.SP);
                    }
                }

                this.state = 967;
                this.match(CypherParser.SUB);
                this.state = 969;
                this.errorHandler.sync(this);
                switch (this.interpreter.adaptivePredict(this.tokenStream, 183, this.context) ) {
                case 1:
                    {
                    this.state = 968;
                    this.match(CypherParser.SP);
                    }
                    break;
                }
                this.state = 972;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 5) {
                    {
                    this.state = 971;
                    this.match(CypherParser.GT);
                    }
                }

                }
                break;
            case CypherParser.SUB:
                this.enterOuterAlt(localContext, 2);
                {
                this.state = 974;
                this.match(CypherParser.SUB);
                this.state = 976;
                this.errorHandler.sync(this);
                switch (this.interpreter.adaptivePredict(this.tokenStream, 185, this.context) ) {
                case 1:
                    {
                    this.state = 975;
                    this.match(CypherParser.SP);
                    }
                    break;
                }
                this.state = 979;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 16) {
                    {
                    this.state = 978;
                    this.relationDetail();
                    }
                }

                this.state = 982;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 981;
                    this.match(CypherParser.SP);
                    }
                }

                this.state = 984;
                this.match(CypherParser.SUB);
                this.state = 986;
                this.errorHandler.sync(this);
                switch (this.interpreter.adaptivePredict(this.tokenStream, 188, this.context) ) {
                case 1:
                    {
                    this.state = 985;
                    this.match(CypherParser.SP);
                    }
                    break;
                }
                this.state = 989;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 5) {
                    {
                    this.state = 988;
                    this.match(CypherParser.GT);
                    }
                }

                }
                break;
            default:
                throw new antlr.NoViableAltException(this);
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public relationDetail(): RelationDetailContext {
        let localContext = new RelationDetailContext(this.context, this.state);
        this.enterRule(localContext, 122, CypherParser.RULE_relationDetail);
        let _la: number;
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 993;
            this.match(CypherParser.LBRACK);
            this.state = 995;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 191, this.context) ) {
            case 1:
                {
                this.state = 994;
                this.match(CypherParser.SP);
                }
                break;
            }
            this.state = 998;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (((((_la - 30)) & ~0x1F) === 0 && ((1 << (_la - 30)) & 63) !== 0) || ((((_la - 89)) & ~0x1F) === 0 && ((1 << (_la - 89)) & 89) !== 0)) {
                {
                this.state = 997;
                this.symbol_();
                }
            }

            this.state = 1001;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 193, this.context) ) {
            case 1:
                {
                this.state = 1000;
                this.match(CypherParser.SP);
                }
                break;
            }
            this.state = 1004;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 25) {
                {
                this.state = 1003;
                this.relationshipTypes();
                }
            }

            this.state = 1007;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 195, this.context) ) {
            case 1:
                {
                this.state = 1006;
                this.match(CypherParser.SP);
                }
                break;
            }
            this.state = 1010;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 23) {
                {
                this.state = 1009;
                this.rangeLit();
                }
            }

            this.state = 1013;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 197, this.context) ) {
            case 1:
                {
                this.state = 1012;
                this.match(CypherParser.SP);
                }
                break;
            }
            this.state = 1016;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 14 || _la === 27) {
                {
                this.state = 1015;
                this.properties();
                }
            }

            this.state = 1019;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 1018;
                this.match(CypherParser.SP);
                }
            }

            this.state = 1021;
            this.match(CypherParser.RBRACK);
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public rangeLit(): RangeLitContext {
        let localContext = new RangeLitContext(this.context, this.state);
        this.enterRule(localContext, 124, CypherParser.RULE_rangeLit);
        let _la: number;
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 1023;
            this.match(CypherParser.MULT);
            this.state = 1025;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 200, this.context) ) {
            case 1:
                {
                this.state = 1024;
                this.match(CypherParser.SP);
                }
                break;
            }
            this.state = 1028;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 92) {
                {
                this.state = 1027;
                this.match(CypherParser.Integer);
                }
            }

            this.state = 1040;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 205, this.context) ) {
            case 1:
                {
                this.state = 1031;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 1030;
                    this.match(CypherParser.SP);
                    }
                }

                this.state = 1033;
                this.match(CypherParser.RANGE);
                this.state = 1035;
                this.errorHandler.sync(this);
                switch (this.interpreter.adaptivePredict(this.tokenStream, 203, this.context) ) {
                case 1:
                    {
                    this.state = 1034;
                    this.match(CypherParser.SP);
                    }
                    break;
                }
                this.state = 1038;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 92) {
                    {
                    this.state = 1037;
                    this.match(CypherParser.Integer);
                    }
                }

                }
                break;
            }
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public relationshipTypes(): RelationshipTypesContext {
        let localContext = new RelationshipTypesContext(this.context, this.state);
        this.enterRule(localContext, 126, CypherParser.RULE_relationshipTypes);
        let _la: number;
        try {
            let alternative: number;
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 1042;
            this.match(CypherParser.COLON);
            this.state = 1044;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 1043;
                this.match(CypherParser.SP);
                }
            }

            this.state = 1046;
            this.name();
            this.state = 1063;
            this.errorHandler.sync(this);
            alternative = this.interpreter.adaptivePredict(this.tokenStream, 211, this.context);
            while (alternative !== 2 && alternative !== antlr.ATN.INVALID_ALT_NUMBER) {
                if (alternative === 1) {
                    {
                    {
                    this.state = 1048;
                    this.errorHandler.sync(this);
                    _la = this.tokenStream.LA(1);
                    if (_la === 99) {
                        {
                        this.state = 1047;
                        this.match(CypherParser.SP);
                        }
                    }

                    this.state = 1050;
                    this.match(CypherParser.STICK);
                    this.state = 1052;
                    this.errorHandler.sync(this);
                    switch (this.interpreter.adaptivePredict(this.tokenStream, 208, this.context) ) {
                    case 1:
                        {
                        this.state = 1051;
                        this.match(CypherParser.SP);
                        }
                        break;
                    }
                    this.state = 1055;
                    this.errorHandler.sync(this);
                    _la = this.tokenStream.LA(1);
                    if (_la === 25) {
                        {
                        this.state = 1054;
                        this.match(CypherParser.COLON);
                        }
                    }

                    this.state = 1058;
                    this.errorHandler.sync(this);
                    _la = this.tokenStream.LA(1);
                    if (_la === 99) {
                        {
                        this.state = 1057;
                        this.match(CypherParser.SP);
                        }
                    }

                    this.state = 1060;
                    this.name();
                    }
                    }
                }
                this.state = 1065;
                this.errorHandler.sync(this);
                alternative = this.interpreter.adaptivePredict(this.tokenStream, 211, this.context);
            }
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public unionSt(): UnionStContext {
        let localContext = new UnionStContext(this.context, this.state);
        this.enterRule(localContext, 128, CypherParser.RULE_unionSt);
        let _la: number;
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 1066;
            this.match(CypherParser.UNION);
            this.state = 1068;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 212, this.context) ) {
            case 1:
                {
                this.state = 1067;
                this.match(CypherParser.SP);
                }
                break;
            }
            this.state = 1071;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 36) {
                {
                this.state = 1070;
                this.match(CypherParser.ALL);
                }
            }

            this.state = 1074;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 1073;
                this.match(CypherParser.SP);
                }
            }

            this.state = 1076;
            this.singleQuery();
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public subqueryExist(): SubqueryExistContext {
        let localContext = new SubqueryExistContext(this.context, this.state);
        this.enterRule(localContext, 130, CypherParser.RULE_subqueryExist);
        let _la: number;
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 1078;
            this.match(CypherParser.EXISTS);
            this.state = 1080;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 1079;
                this.match(CypherParser.SP);
                }
            }

            this.state = 1082;
            this.match(CypherParser.LBRACE);
            this.state = 1084;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 1083;
                this.match(CypherParser.SP);
                }
            }

            this.state = 1088;
            this.errorHandler.sync(this);
            switch (this.tokenStream.LA(1)) {
            case CypherParser.CALL:
            case CypherParser.CREATE:
            case CypherParser.DELETE:
            case CypherParser.DETACH:
            case CypherParser.MATCH:
            case CypherParser.MERGE:
            case CypherParser.OPTIONAL:
            case CypherParser.REMOVE:
            case CypherParser.RETURN:
            case CypherParser.SET:
            case CypherParser.WITH:
            case CypherParser.UNWIND:
                {
                this.state = 1086;
                this.regularQuery();
                }
                break;
            case CypherParser.LPAREN:
            case CypherParser.FILTER:
            case CypherParser.EXTRACT:
            case CypherParser.COUNT:
            case CypherParser.ANY:
            case CypherParser.NONE:
            case CypherParser.SINGLE:
            case CypherParser.ESC_LITERAL:
            case CypherParser.Integer:
            case CypherParser.DIGIT:
            case CypherParser.ID:
                {
                this.state = 1087;
                this.patternWhere();
                }
                break;
            default:
                throw new antlr.NoViableAltException(this);
            }
            this.state = 1091;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 1090;
                this.match(CypherParser.SP);
                }
            }

            this.state = 1093;
            this.match(CypherParser.RBRACE);
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public invocationName(): InvocationNameContext {
        let localContext = new InvocationNameContext(this.context, this.state);
        this.enterRule(localContext, 132, CypherParser.RULE_invocationName);
        let _la: number;
        try {
            let alternative: number;
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 1095;
            this.symbol_();
            this.state = 1106;
            this.errorHandler.sync(this);
            alternative = this.interpreter.adaptivePredict(this.tokenStream, 221, this.context);
            while (alternative !== 2 && alternative !== antlr.ATN.INVALID_ALT_NUMBER) {
                if (alternative === 1) {
                    {
                    {
                    this.state = 1097;
                    this.errorHandler.sync(this);
                    _la = this.tokenStream.LA(1);
                    if (_la === 99) {
                        {
                        this.state = 1096;
                        this.match(CypherParser.SP);
                        }
                    }

                    this.state = 1099;
                    this.match(CypherParser.DOT);
                    this.state = 1101;
                    this.errorHandler.sync(this);
                    _la = this.tokenStream.LA(1);
                    if (_la === 99) {
                        {
                        this.state = 1100;
                        this.match(CypherParser.SP);
                        }
                    }

                    this.state = 1103;
                    this.symbol_();
                    }
                    }
                }
                this.state = 1108;
                this.errorHandler.sync(this);
                alternative = this.interpreter.adaptivePredict(this.tokenStream, 221, this.context);
            }
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public functionInvocation(): FunctionInvocationContext {
        let localContext = new FunctionInvocationContext(this.context, this.state);
        this.enterRule(localContext, 134, CypherParser.RULE_functionInvocation);
        let _la: number;
        try {
            this.state = 1151;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 233, this.context) ) {
            case 1:
                this.enterOuterAlt(localContext, 1);
                {
                this.state = 1109;
                this.invocationName();
                this.state = 1111;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 1110;
                    this.match(CypherParser.SP);
                    }
                }

                this.state = 1113;
                this.match(CypherParser.LPAREN);
                this.state = 1115;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 1114;
                    this.match(CypherParser.SP);
                    }
                }

                this.state = 1121;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 63) {
                    {
                    this.state = 1117;
                    this.match(CypherParser.DISTINCT);
                    this.state = 1119;
                    this.errorHandler.sync(this);
                    _la = this.tokenStream.LA(1);
                    if (_la === 99) {
                        {
                        this.state = 1118;
                        this.match(CypherParser.SP);
                        }
                    }

                    }
                }

                this.state = 1123;
                this.patternElem();
                this.state = 1125;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 1124;
                    this.match(CypherParser.SP);
                    }
                }

                this.state = 1127;
                this.match(CypherParser.RPAREN);
                }
                break;
            case 2:
                this.enterOuterAlt(localContext, 2);
                {
                this.state = 1129;
                this.invocationName();
                this.state = 1131;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 1130;
                    this.match(CypherParser.SP);
                    }
                }

                this.state = 1133;
                this.match(CypherParser.LPAREN);
                this.state = 1135;
                this.errorHandler.sync(this);
                switch (this.interpreter.adaptivePredict(this.tokenStream, 228, this.context) ) {
                case 1:
                    {
                    this.state = 1134;
                    this.match(CypherParser.SP);
                    }
                    break;
                }
                this.state = 1141;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 63) {
                    {
                    this.state = 1137;
                    this.match(CypherParser.DISTINCT);
                    this.state = 1139;
                    this.errorHandler.sync(this);
                    switch (this.interpreter.adaptivePredict(this.tokenStream, 229, this.context) ) {
                    case 1:
                        {
                        this.state = 1138;
                        this.match(CypherParser.SP);
                        }
                        break;
                    }
                    }
                }

                this.state = 1144;
                this.errorHandler.sync(this);
                switch (this.interpreter.adaptivePredict(this.tokenStream, 231, this.context) ) {
                case 1:
                    {
                    this.state = 1143;
                    this.expressionChain();
                    }
                    break;
                }
                this.state = 1147;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 1146;
                    this.match(CypherParser.SP);
                    }
                }

                this.state = 1149;
                this.match(CypherParser.RPAREN);
                }
                break;
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public parenthesizedExpression(): ParenthesizedExpressionContext {
        let localContext = new ParenthesizedExpressionContext(this.context, this.state);
        this.enterRule(localContext, 136, CypherParser.RULE_parenthesizedExpression);
        let _la: number;
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 1153;
            this.match(CypherParser.LPAREN);
            this.state = 1155;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 234, this.context) ) {
            case 1:
                {
                this.state = 1154;
                this.match(CypherParser.SP);
                }
                break;
            }
            this.state = 1157;
            this.expression();
            this.state = 1159;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 1158;
                this.match(CypherParser.SP);
                }
            }

            this.state = 1161;
            this.match(CypherParser.RPAREN);
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public filterWith(): FilterWithContext {
        let localContext = new FilterWithContext(this.context, this.state);
        this.enterRule(localContext, 138, CypherParser.RULE_filterWith);
        let _la: number;
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 1163;
            _la = this.tokenStream.LA(1);
            if(!(((((_la - 33)) & ~0x1F) === 0 && ((1 << (_la - 33)) & 15) !== 0))) {
            this.errorHandler.recoverInline(this);
            }
            else {
                this.errorHandler.reportMatch(this);
                this.consume();
            }
            this.state = 1165;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 1164;
                this.match(CypherParser.SP);
                }
            }

            this.state = 1167;
            this.match(CypherParser.LPAREN);
            this.state = 1169;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 1168;
                this.match(CypherParser.SP);
                }
            }

            this.state = 1171;
            this.filterExpression();
            this.state = 1173;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 1172;
                this.match(CypherParser.SP);
                }
            }

            this.state = 1175;
            this.match(CypherParser.RPAREN);
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public patternComprehension(): PatternComprehensionContext {
        let localContext = new PatternComprehensionContext(this.context, this.state);
        this.enterRule(localContext, 140, CypherParser.RULE_patternComprehension);
        let _la: number;
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 1177;
            this.match(CypherParser.LBRACK);
            this.state = 1179;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 1178;
                this.match(CypherParser.SP);
                }
            }

            this.state = 1189;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (((((_la - 30)) & ~0x1F) === 0 && ((1 << (_la - 30)) & 63) !== 0) || ((((_la - 89)) & ~0x1F) === 0 && ((1 << (_la - 89)) & 89) !== 0)) {
                {
                this.state = 1181;
                this.lhs();
                this.state = 1183;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 1182;
                    this.match(CypherParser.SP);
                    }
                }

                this.state = 1185;
                this.match(CypherParser.ASSIGN);
                this.state = 1187;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 1186;
                    this.match(CypherParser.SP);
                    }
                }

                }
            }

            this.state = 1191;
            this.relationshipsChainPattern();
            this.state = 1196;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 244, this.context) ) {
            case 1:
                {
                this.state = 1193;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 1192;
                    this.match(CypherParser.SP);
                    }
                }

                this.state = 1195;
                this.where();
                }
                break;
            }
            this.state = 1199;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 1198;
                this.match(CypherParser.SP);
                }
            }

            this.state = 1201;
            this.match(CypherParser.STICK);
            this.state = 1203;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 246, this.context) ) {
            case 1:
                {
                this.state = 1202;
                this.match(CypherParser.SP);
                }
                break;
            }
            this.state = 1205;
            this.expression();
            this.state = 1207;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 1206;
                this.match(CypherParser.SP);
                }
            }

            this.state = 1209;
            this.match(CypherParser.RBRACK);
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public relationshipsChainPattern(): RelationshipsChainPatternContext {
        let localContext = new RelationshipsChainPatternContext(this.context, this.state);
        this.enterRule(localContext, 142, CypherParser.RULE_relationshipsChainPattern);
        let _la: number;
        try {
            let alternative: number;
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 1211;
            this.nodePattern();
            this.state = 1216;
            this.errorHandler.sync(this);
            alternative = 1;
            do {
                switch (alternative) {
                case 1:
                    {
                    {
                    this.state = 1213;
                    this.errorHandler.sync(this);
                    _la = this.tokenStream.LA(1);
                    if (_la === 99) {
                        {
                        this.state = 1212;
                        this.match(CypherParser.SP);
                        }
                    }

                    this.state = 1215;
                    this.patternElemChain();
                    }
                    }
                    break;
                default:
                    throw new antlr.NoViableAltException(this);
                }
                this.state = 1218;
                this.errorHandler.sync(this);
                alternative = this.interpreter.adaptivePredict(this.tokenStream, 249, this.context);
            } while (alternative !== 2 && alternative !== antlr.ATN.INVALID_ALT_NUMBER);
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public listComprehension(): ListComprehensionContext {
        let localContext = new ListComprehensionContext(this.context, this.state);
        this.enterRule(localContext, 144, CypherParser.RULE_listComprehension);
        let _la: number;
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 1220;
            this.match(CypherParser.LBRACK);
            this.state = 1222;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 1221;
                this.match(CypherParser.SP);
                }
            }

            this.state = 1224;
            this.filterExpression();
            this.state = 1233;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 253, this.context) ) {
            case 1:
                {
                this.state = 1226;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 1225;
                    this.match(CypherParser.SP);
                    }
                }

                this.state = 1228;
                this.match(CypherParser.STICK);
                this.state = 1230;
                this.errorHandler.sync(this);
                switch (this.interpreter.adaptivePredict(this.tokenStream, 252, this.context) ) {
                case 1:
                    {
                    this.state = 1229;
                    this.match(CypherParser.SP);
                    }
                    break;
                }
                this.state = 1232;
                this.expression();
                }
                break;
            }
            this.state = 1236;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 1235;
                this.match(CypherParser.SP);
                }
            }

            this.state = 1238;
            this.match(CypherParser.RBRACK);
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public filterExpression(): FilterExpressionContext {
        let localContext = new FilterExpressionContext(this.context, this.state);
        this.enterRule(localContext, 146, CypherParser.RULE_filterExpression);
        let _la: number;
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 1240;
            this.symbol_();
            this.state = 1242;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 1241;
                this.match(CypherParser.SP);
                }
            }

            this.state = 1244;
            this.match(CypherParser.IN);
            this.state = 1246;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 256, this.context) ) {
            case 1:
                {
                this.state = 1245;
                this.match(CypherParser.SP);
                }
                break;
            }
            this.state = 1248;
            this.expression();
            this.state = 1253;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 258, this.context) ) {
            case 1:
                {
                this.state = 1250;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 1249;
                    this.match(CypherParser.SP);
                    }
                }

                this.state = 1252;
                this.where();
                }
                break;
            }
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public countAll(): CountAllContext {
        let localContext = new CountAllContext(this.context, this.state);
        this.enterRule(localContext, 148, CypherParser.RULE_countAll);
        let _la: number;
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 1255;
            this.match(CypherParser.COUNT);
            this.state = 1257;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 1256;
                this.match(CypherParser.SP);
                }
            }

            this.state = 1259;
            this.match(CypherParser.LPAREN);
            this.state = 1261;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 1260;
                this.match(CypherParser.SP);
                }
            }

            this.state = 1263;
            this.match(CypherParser.MULT);
            this.state = 1265;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 1264;
                this.match(CypherParser.SP);
                }
            }

            this.state = 1267;
            this.match(CypherParser.RPAREN);
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public expressionChain(): ExpressionChainContext {
        let localContext = new ExpressionChainContext(this.context, this.state);
        this.enterRule(localContext, 150, CypherParser.RULE_expressionChain);
        let _la: number;
        try {
            let alternative: number;
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 1269;
            this.expression();
            this.state = 1280;
            this.errorHandler.sync(this);
            alternative = this.interpreter.adaptivePredict(this.tokenStream, 264, this.context);
            while (alternative !== 2 && alternative !== antlr.ATN.INVALID_ALT_NUMBER) {
                if (alternative === 1) {
                    {
                    {
                    this.state = 1271;
                    this.errorHandler.sync(this);
                    _la = this.tokenStream.LA(1);
                    if (_la === 99) {
                        {
                        this.state = 1270;
                        this.match(CypherParser.SP);
                        }
                    }

                    this.state = 1273;
                    this.match(CypherParser.COMMA);
                    this.state = 1275;
                    this.errorHandler.sync(this);
                    switch (this.interpreter.adaptivePredict(this.tokenStream, 263, this.context) ) {
                    case 1:
                        {
                        this.state = 1274;
                        this.match(CypherParser.SP);
                        }
                        break;
                    }
                    this.state = 1277;
                    this.expression();
                    }
                    }
                }
                this.state = 1282;
                this.errorHandler.sync(this);
                alternative = this.interpreter.adaptivePredict(this.tokenStream, 264, this.context);
            }
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public caseExpression(): CaseExpressionContext {
        let localContext = new CaseExpressionContext(this.context, this.state);
        this.enterRule(localContext, 152, CypherParser.RULE_caseExpression);
        let _la: number;
        try {
            let alternative: number;
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 1283;
            this.match(CypherParser.CASE);
            this.state = 1285;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 265, this.context) ) {
            case 1:
                {
                this.state = 1284;
                this.match(CypherParser.SP);
                }
                break;
            }
            this.state = 1288;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 266, this.context) ) {
            case 1:
                {
                this.state = 1287;
                this.expression();
                }
                break;
            }
            this.state = 1307;
            this.errorHandler.sync(this);
            alternative = 1;
            do {
                switch (alternative) {
                case 1:
                    {
                    {
                    this.state = 1291;
                    this.errorHandler.sync(this);
                    _la = this.tokenStream.LA(1);
                    if (_la === 99) {
                        {
                        this.state = 1290;
                        this.match(CypherParser.SP);
                        }
                    }

                    this.state = 1293;
                    this.match(CypherParser.WHEN);
                    this.state = 1295;
                    this.errorHandler.sync(this);
                    switch (this.interpreter.adaptivePredict(this.tokenStream, 268, this.context) ) {
                    case 1:
                        {
                        this.state = 1294;
                        this.match(CypherParser.SP);
                        }
                        break;
                    }
                    this.state = 1297;
                    this.expression();
                    this.state = 1299;
                    this.errorHandler.sync(this);
                    _la = this.tokenStream.LA(1);
                    if (_la === 99) {
                        {
                        this.state = 1298;
                        this.match(CypherParser.SP);
                        }
                    }

                    this.state = 1301;
                    this.match(CypherParser.THEN);
                    this.state = 1303;
                    this.errorHandler.sync(this);
                    switch (this.interpreter.adaptivePredict(this.tokenStream, 270, this.context) ) {
                    case 1:
                        {
                        this.state = 1302;
                        this.match(CypherParser.SP);
                        }
                        break;
                    }
                    this.state = 1305;
                    this.expression();
                    }
                    }
                    break;
                default:
                    throw new antlr.NoViableAltException(this);
                }
                this.state = 1309;
                this.errorHandler.sync(this);
                alternative = this.interpreter.adaptivePredict(this.tokenStream, 271, this.context);
            } while (alternative !== 2 && alternative !== antlr.ATN.INVALID_ALT_NUMBER);
            this.state = 1319;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 274, this.context) ) {
            case 1:
                {
                this.state = 1312;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 1311;
                    this.match(CypherParser.SP);
                    }
                }

                this.state = 1314;
                this.match(CypherParser.ELSE);
                this.state = 1316;
                this.errorHandler.sync(this);
                switch (this.interpreter.adaptivePredict(this.tokenStream, 273, this.context) ) {
                case 1:
                    {
                    this.state = 1315;
                    this.match(CypherParser.SP);
                    }
                    break;
                }
                this.state = 1318;
                this.expression();
                }
                break;
            }
            this.state = 1322;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 1321;
                this.match(CypherParser.SP);
                }
            }

            this.state = 1324;
            this.match(CypherParser.END);
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public parameter(): ParameterContext {
        let localContext = new ParameterContext(this.context, this.state);
        this.enterRule(localContext, 154, CypherParser.RULE_parameter);
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 1326;
            this.match(CypherParser.DOLLAR);
            this.state = 1329;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 276, this.context) ) {
            case 1:
                {
                this.state = 1327;
                this.symbol_();
                }
                break;
            case 2:
                {
                this.state = 1328;
                this.numLit();
                }
                break;
            }
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public literal(): LiteralContext {
        let localContext = new LiteralContext(this.context, this.state);
        this.enterRule(localContext, 156, CypherParser.RULE_literal);
        try {
            this.state = 1338;
            this.errorHandler.sync(this);
            switch (this.tokenStream.LA(1)) {
            case CypherParser.FALSE:
            case CypherParser.TRUE:
                this.enterOuterAlt(localContext, 1);
                {
                this.state = 1331;
                this.boolLit();
                }
                break;
            case CypherParser.DIGIT:
                this.enterOuterAlt(localContext, 2);
                {
                this.state = 1332;
                this.numLit();
                }
                break;
            case CypherParser.NULL_W:
                this.enterOuterAlt(localContext, 3);
                {
                this.state = 1333;
                this.match(CypherParser.NULL_W);
                }
                break;
            case CypherParser.STRING_LITERAL:
                this.enterOuterAlt(localContext, 4);
                {
                this.state = 1334;
                this.stringLit();
                }
                break;
            case CypherParser.CHAR_LITERAL:
                this.enterOuterAlt(localContext, 5);
                {
                this.state = 1335;
                this.charLit();
                }
                break;
            case CypherParser.LBRACK:
                this.enterOuterAlt(localContext, 6);
                {
                this.state = 1336;
                this.listLit();
                }
                break;
            case CypherParser.LBRACE:
                this.enterOuterAlt(localContext, 7);
                {
                this.state = 1337;
                this.mapLit();
                }
                break;
            default:
                throw new antlr.NoViableAltException(this);
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public boolLit(): BoolLitContext {
        let localContext = new BoolLitContext(this.context, this.state);
        this.enterRule(localContext, 158, CypherParser.RULE_boolLit);
        let _la: number;
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 1340;
            _la = this.tokenStream.LA(1);
            if(!(_la === 71 || _la === 72)) {
            this.errorHandler.recoverInline(this);
            }
            else {
                this.errorHandler.reportMatch(this);
                this.consume();
            }
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public numLit(): NumLitContext {
        let localContext = new NumLitContext(this.context, this.state);
        this.enterRule(localContext, 160, CypherParser.RULE_numLit);
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 1342;
            this.match(CypherParser.DIGIT);
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public stringLit(): StringLitContext {
        let localContext = new StringLitContext(this.context, this.state);
        this.enterRule(localContext, 162, CypherParser.RULE_stringLit);
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 1344;
            this.match(CypherParser.STRING_LITERAL);
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public charLit(): CharLitContext {
        let localContext = new CharLitContext(this.context, this.state);
        this.enterRule(localContext, 164, CypherParser.RULE_charLit);
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 1346;
            this.match(CypherParser.CHAR_LITERAL);
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public listLit(): ListLitContext {
        let localContext = new ListLitContext(this.context, this.state);
        this.enterRule(localContext, 166, CypherParser.RULE_listLit);
        let _la: number;
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 1348;
            this.match(CypherParser.LBRACK);
            this.state = 1350;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 278, this.context) ) {
            case 1:
                {
                this.state = 1349;
                this.match(CypherParser.SP);
                }
                break;
            }
            this.state = 1353;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 279, this.context) ) {
            case 1:
                {
                this.state = 1352;
                this.expressionChain();
                }
                break;
            }
            this.state = 1356;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 1355;
                this.match(CypherParser.SP);
                }
            }

            this.state = 1358;
            this.match(CypherParser.RBRACK);
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public mapLit(): MapLitContext {
        let localContext = new MapLitContext(this.context, this.state);
        this.enterRule(localContext, 168, CypherParser.RULE_mapLit);
        let _la: number;
        try {
            let alternative: number;
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 1360;
            this.match(CypherParser.LBRACE);
            this.state = 1362;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 281, this.context) ) {
            case 1:
                {
                this.state = 1361;
                this.match(CypherParser.SP);
                }
                break;
            }
            this.state = 1378;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 30 || _la === 31 || ((((_la - 32)) & ~0x1F) === 0 && ((1 << (_la - 32)) & 4294967295) !== 0) || ((((_la - 64)) & ~0x1F) === 0 && ((1 << (_la - 64)) & 3019898879) !== 0)) {
                {
                this.state = 1364;
                this.mapPair();
                this.state = 1375;
                this.errorHandler.sync(this);
                alternative = this.interpreter.adaptivePredict(this.tokenStream, 284, this.context);
                while (alternative !== 2 && alternative !== antlr.ATN.INVALID_ALT_NUMBER) {
                    if (alternative === 1) {
                        {
                        {
                        this.state = 1366;
                        this.errorHandler.sync(this);
                        _la = this.tokenStream.LA(1);
                        if (_la === 99) {
                            {
                            this.state = 1365;
                            this.match(CypherParser.SP);
                            }
                        }

                        this.state = 1368;
                        this.match(CypherParser.COMMA);
                        this.state = 1370;
                        this.errorHandler.sync(this);
                        _la = this.tokenStream.LA(1);
                        if (_la === 99) {
                            {
                            this.state = 1369;
                            this.match(CypherParser.SP);
                            }
                        }

                        this.state = 1372;
                        this.mapPair();
                        }
                        }
                    }
                    this.state = 1377;
                    this.errorHandler.sync(this);
                    alternative = this.interpreter.adaptivePredict(this.tokenStream, 284, this.context);
                }
                }
            }

            this.state = 1381;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 1380;
                this.match(CypherParser.SP);
                }
            }

            this.state = 1383;
            this.match(CypherParser.RBRACE);
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public mapPair(): MapPairContext {
        let localContext = new MapPairContext(this.context, this.state);
        this.enterRule(localContext, 170, CypherParser.RULE_mapPair);
        let _la: number;
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 1385;
            this.name();
            this.state = 1387;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 1386;
                this.match(CypherParser.SP);
                }
            }

            this.state = 1389;
            this.match(CypherParser.COLON);
            this.state = 1391;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 288, this.context) ) {
            case 1:
                {
                this.state = 1390;
                this.match(CypherParser.SP);
                }
                break;
            }
            this.state = 1393;
            this.expression();
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public name(): NameContext {
        let localContext = new NameContext(this.context, this.state);
        this.enterRule(localContext, 172, CypherParser.RULE_name);
        try {
            this.state = 1397;
            this.errorHandler.sync(this);
            switch (this.tokenStream.LA(1)) {
            case CypherParser.FILTER:
            case CypherParser.EXTRACT:
            case CypherParser.COUNT:
            case CypherParser.ANY:
            case CypherParser.NONE:
            case CypherParser.SINGLE:
            case CypherParser.ESC_LITERAL:
            case CypherParser.Integer:
            case CypherParser.DIGIT:
            case CypherParser.ID:
                this.enterOuterAlt(localContext, 1);
                {
                this.state = 1395;
                this.symbol_();
                }
                break;
            case CypherParser.ALL:
            case CypherParser.ASC:
            case CypherParser.ASCENDING:
            case CypherParser.BY:
            case CypherParser.CREATE:
            case CypherParser.DELETE:
            case CypherParser.DESC:
            case CypherParser.DESCENDING:
            case CypherParser.DETACH:
            case CypherParser.EXISTS:
            case CypherParser.LIMIT:
            case CypherParser.MATCH:
            case CypherParser.MERGE:
            case CypherParser.ON:
            case CypherParser.OPTIONAL:
            case CypherParser.ORDER:
            case CypherParser.REMOVE:
            case CypherParser.RETURN:
            case CypherParser.SET:
            case CypherParser.SKIP_W:
            case CypherParser.WHERE:
            case CypherParser.WITH:
            case CypherParser.UNION:
            case CypherParser.UNWIND:
            case CypherParser.AND:
            case CypherParser.AS:
            case CypherParser.CONTAINS:
            case CypherParser.DISTINCT:
            case CypherParser.ENDS:
            case CypherParser.IN:
            case CypherParser.IS:
            case CypherParser.NOT:
            case CypherParser.OR:
            case CypherParser.STARTS:
            case CypherParser.XOR:
            case CypherParser.FALSE:
            case CypherParser.TRUE:
            case CypherParser.NULL_W:
            case CypherParser.CONSTRAINT:
            case CypherParser.DO:
            case CypherParser.FOR:
            case CypherParser.REQUIRE:
            case CypherParser.UNIQUE:
            case CypherParser.CASE:
            case CypherParser.WHEN:
            case CypherParser.THEN:
            case CypherParser.ELSE:
            case CypherParser.END:
            case CypherParser.MANDATORY:
            case CypherParser.SCALAR:
            case CypherParser.OF:
            case CypherParser.ADD:
            case CypherParser.DROP:
                this.enterOuterAlt(localContext, 2);
                {
                this.state = 1396;
                this.reservedWord();
                }
                break;
            default:
                throw new antlr.NoViableAltException(this);
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public symbol_(): SymbolContext {
        let localContext = new SymbolContext(this.context, this.state);
        this.enterRule(localContext, 174, CypherParser.RULE_symbol);
        let _la: number;
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 1399;
            _la = this.tokenStream.LA(1);
            if(!(((((_la - 30)) & ~0x1F) === 0 && ((1 << (_la - 30)) & 63) !== 0) || ((((_la - 89)) & ~0x1F) === 0 && ((1 << (_la - 89)) & 89) !== 0))) {
            this.errorHandler.recoverInline(this);
            }
            else {
                this.errorHandler.reportMatch(this);
                this.consume();
            }
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public reservedWord(): ReservedWordContext {
        let localContext = new ReservedWordContext(this.context, this.state);
        this.enterRule(localContext, 176, CypherParser.RULE_reservedWord);
        let _la: number;
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 1401;
            _la = this.tokenStream.LA(1);
            if(!(((((_la - 36)) & ~0x1F) === 0 && ((1 << (_la - 36)) & 4294967295) !== 0) || ((((_la - 68)) & ~0x1F) === 0 && ((1 << (_la - 68)) & 2097151) !== 0))) {
            this.errorHandler.recoverInline(this);
            }
            else {
                this.errorHandler.reportMatch(this);
                this.consume();
            }
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }

    public static readonly _serializedATN: number[] = [
        4,1,101,1404,2,0,7,0,2,1,7,1,2,2,7,2,2,3,7,3,2,4,7,4,2,5,7,5,2,6,
        7,6,2,7,7,7,2,8,7,8,2,9,7,9,2,10,7,10,2,11,7,11,2,12,7,12,2,13,7,
        13,2,14,7,14,2,15,7,15,2,16,7,16,2,17,7,17,2,18,7,18,2,19,7,19,2,
        20,7,20,2,21,7,21,2,22,7,22,2,23,7,23,2,24,7,24,2,25,7,25,2,26,7,
        26,2,27,7,27,2,28,7,28,2,29,7,29,2,30,7,30,2,31,7,31,2,32,7,32,2,
        33,7,33,2,34,7,34,2,35,7,35,2,36,7,36,2,37,7,37,2,38,7,38,2,39,7,
        39,2,40,7,40,2,41,7,41,2,42,7,42,2,43,7,43,2,44,7,44,2,45,7,45,2,
        46,7,46,2,47,7,47,2,48,7,48,2,49,7,49,2,50,7,50,2,51,7,51,2,52,7,
        52,2,53,7,53,2,54,7,54,2,55,7,55,2,56,7,56,2,57,7,57,2,58,7,58,2,
        59,7,59,2,60,7,60,2,61,7,61,2,62,7,62,2,63,7,63,2,64,7,64,2,65,7,
        65,2,66,7,66,2,67,7,67,2,68,7,68,2,69,7,69,2,70,7,70,2,71,7,71,2,
        72,7,72,2,73,7,73,2,74,7,74,2,75,7,75,2,76,7,76,2,77,7,77,2,78,7,
        78,2,79,7,79,2,80,7,80,2,81,7,81,2,82,7,82,2,83,7,83,2,84,7,84,2,
        85,7,85,2,86,7,86,2,87,7,87,2,88,7,88,1,0,3,0,180,8,0,1,0,1,0,3,
        0,184,8,0,1,0,3,0,187,8,0,1,0,3,0,190,8,0,1,0,1,0,1,1,1,1,3,1,196,
        8,1,1,2,1,2,5,2,200,8,2,10,2,12,2,203,9,2,1,3,1,3,3,3,207,8,3,1,
        4,1,4,3,4,211,8,4,1,4,1,4,3,4,215,8,4,1,4,3,4,218,8,4,1,4,3,4,221,
        8,4,1,4,1,4,3,4,225,8,4,1,4,1,4,3,4,229,8,4,3,4,231,8,4,1,5,1,5,
        3,5,235,8,5,1,5,1,5,1,6,1,6,3,6,241,8,6,1,6,1,6,3,6,245,8,6,1,6,
        3,6,248,8,6,1,7,1,7,3,7,252,8,7,1,7,1,7,1,8,1,8,3,8,258,8,8,1,8,
        1,8,1,9,3,9,263,8,9,1,9,3,9,266,8,9,1,9,3,9,269,8,9,1,9,1,9,3,9,
        273,8,9,1,9,3,9,276,8,9,1,9,3,9,279,8,9,1,9,3,9,282,8,9,1,9,3,9,
        285,8,9,1,9,3,9,288,8,9,1,10,1,10,3,10,292,8,10,1,10,3,10,295,8,
        10,1,10,1,10,3,10,299,8,10,1,10,5,10,302,8,10,10,10,12,10,305,9,
        10,1,11,1,11,3,11,309,8,11,1,11,1,11,3,11,313,8,11,1,11,3,11,316,
        8,11,1,12,1,12,3,12,320,8,12,1,12,3,12,323,8,12,1,13,1,13,3,13,327,
        8,13,1,13,1,13,3,13,331,8,13,1,13,1,13,3,13,335,8,13,1,13,1,13,3,
        13,339,8,13,1,13,5,13,342,8,13,10,13,12,13,345,9,13,1,14,1,14,3,
        14,349,8,14,5,14,351,8,14,10,14,12,14,354,9,14,1,14,1,14,1,14,3,
        14,359,8,14,4,14,361,8,14,11,14,12,14,362,1,14,3,14,366,8,14,1,14,
        3,14,369,8,14,3,14,371,8,14,1,15,1,15,3,15,375,8,15,5,15,377,8,15,
        10,15,12,15,380,9,15,1,15,1,15,3,15,384,8,15,5,15,386,8,15,10,15,
        12,15,389,9,15,1,15,1,15,3,15,393,8,15,1,15,1,15,1,16,1,16,3,16,
        399,8,16,1,16,1,16,3,16,403,8,16,1,16,1,16,1,17,1,17,3,17,409,8,
        17,1,17,1,17,3,17,413,8,17,1,17,1,17,3,17,417,8,17,1,17,1,17,1,18,
        1,18,1,18,3,18,424,8,18,1,19,1,19,1,19,1,19,1,19,3,19,431,8,19,1,
        20,1,20,3,20,435,8,20,1,20,1,20,3,20,439,8,20,1,20,1,20,1,21,1,21,
        3,21,445,8,21,1,21,1,21,3,21,449,8,21,1,21,1,21,3,21,453,8,21,1,
        21,5,21,456,8,21,10,21,12,21,459,9,21,1,22,1,22,3,22,463,8,22,1,
        22,1,22,1,22,3,22,468,8,22,1,23,1,23,3,23,472,8,23,1,23,1,23,3,23,
        476,8,23,1,23,1,23,3,23,480,8,23,1,23,1,23,3,23,484,8,23,1,23,3,
        23,487,8,23,1,24,1,24,3,24,491,8,24,1,24,3,24,494,8,24,1,24,3,24,
        497,8,24,1,24,1,24,1,25,1,25,3,25,503,8,25,1,25,1,25,3,25,507,8,
        25,1,25,5,25,510,8,25,10,25,12,25,513,9,25,1,25,3,25,516,8,25,1,
        25,3,25,519,8,25,1,26,1,26,3,26,523,8,26,1,26,1,26,3,26,527,8,26,
        3,26,529,8,26,1,26,1,26,1,27,1,27,3,27,535,8,27,1,27,1,27,3,27,539,
        8,27,1,27,5,27,542,8,27,10,27,12,27,545,9,27,1,28,1,28,3,28,549,
        8,28,1,28,1,28,3,28,553,8,28,1,28,1,28,1,29,1,29,3,29,559,8,29,1,
        29,1,29,3,29,563,8,29,1,29,1,29,3,29,567,8,29,1,29,5,29,570,8,29,
        10,29,12,29,573,9,29,1,30,1,30,3,30,577,8,30,1,30,1,30,3,30,581,
        8,30,1,30,1,30,1,30,1,30,3,30,587,8,30,1,30,1,30,3,30,591,8,30,1,
        30,1,30,1,30,1,30,3,30,597,8,30,1,30,1,30,3,30,601,8,30,1,31,1,31,
        3,31,605,8,31,1,31,4,31,608,8,31,11,31,12,31,609,1,32,1,32,3,32,
        614,8,32,1,32,1,32,1,33,1,33,3,33,620,8,33,1,33,3,33,623,8,33,1,
        34,1,34,3,34,627,8,34,1,34,1,34,1,35,1,35,3,35,633,8,35,1,35,1,35,
        3,35,637,8,35,1,35,5,35,640,8,35,10,35,12,35,643,9,35,1,36,1,36,
        3,36,647,8,36,1,36,1,36,3,36,651,8,36,1,36,5,36,654,8,36,10,36,12,
        36,657,9,36,1,37,1,37,3,37,661,8,37,1,37,1,37,3,37,665,8,37,1,37,
        5,37,668,8,37,10,37,12,37,671,9,37,1,38,1,38,3,38,675,8,38,1,38,
        1,38,3,38,679,8,38,1,38,5,38,682,8,38,10,38,12,38,685,9,38,1,39,
        1,39,3,39,689,8,39,5,39,691,8,39,10,39,12,39,694,9,39,1,39,1,39,
        1,40,1,40,3,40,700,8,40,1,40,1,40,3,40,704,8,40,1,40,1,40,5,40,708,
        8,40,10,40,12,40,711,9,40,1,41,1,41,1,42,1,42,3,42,717,8,42,1,42,
        1,42,3,42,721,8,42,1,42,5,42,724,8,42,10,42,12,42,727,9,42,1,43,
        1,43,3,43,731,8,43,1,43,1,43,3,43,735,8,43,1,43,5,43,738,8,43,10,
        43,12,43,741,9,43,1,44,1,44,3,44,745,8,44,1,44,1,44,3,44,749,8,44,
        1,44,5,44,752,8,44,10,44,12,44,755,9,44,1,45,3,45,758,8,45,1,45,
        3,45,761,8,45,1,45,1,45,1,46,1,46,3,46,767,8,46,1,46,1,46,1,46,3,
        46,772,8,46,5,46,774,8,46,10,46,12,46,777,9,46,1,47,3,47,780,8,47,
        1,47,1,47,3,47,784,8,47,1,47,1,47,1,47,3,47,789,8,47,1,47,3,47,792,
        8,47,1,47,3,47,795,8,47,1,47,1,47,3,47,799,8,47,1,47,3,47,802,8,
        47,1,47,3,47,805,8,47,1,47,3,47,808,8,47,1,47,3,47,811,8,47,1,48,
        1,48,3,48,815,8,48,1,48,1,48,1,49,1,49,3,49,821,8,49,1,49,1,49,1,
        49,3,49,826,8,49,1,49,1,49,3,49,830,8,49,1,50,3,50,833,8,50,1,50,
        1,50,3,50,837,8,50,1,50,3,50,840,8,50,1,50,3,50,843,8,50,1,50,1,
        50,1,51,1,51,3,51,849,8,51,1,51,3,51,852,8,51,1,52,1,52,3,52,856,
        8,52,1,52,1,52,3,52,860,8,52,1,52,5,52,863,8,52,10,52,12,52,866,
        9,52,1,53,1,53,3,53,870,8,53,1,53,1,53,3,53,874,8,53,3,53,876,8,
        53,1,53,1,53,1,54,1,54,3,54,882,8,54,1,54,5,54,885,8,54,10,54,12,
        54,888,9,54,1,54,1,54,3,54,892,8,54,1,54,1,54,3,54,896,8,54,1,54,
        1,54,1,54,3,54,901,8,54,1,55,1,55,3,55,905,8,55,1,55,1,55,1,56,1,
        56,3,56,911,8,56,1,57,1,57,3,57,915,8,57,1,57,3,57,918,8,57,1,57,
        3,57,921,8,57,1,57,3,57,924,8,57,1,57,3,57,927,8,57,1,57,3,57,930,
        8,57,1,57,3,57,933,8,57,1,57,1,57,1,58,1,58,1,58,1,58,1,58,1,58,
        1,58,1,58,1,58,1,58,1,58,1,58,3,58,949,8,58,1,59,1,59,1,59,1,60,
        1,60,3,60,956,8,60,1,60,1,60,3,60,960,8,60,1,60,3,60,963,8,60,1,
        60,3,60,966,8,60,1,60,1,60,3,60,970,8,60,1,60,3,60,973,8,60,1,60,
        1,60,3,60,977,8,60,1,60,3,60,980,8,60,1,60,3,60,983,8,60,1,60,1,
        60,3,60,987,8,60,1,60,3,60,990,8,60,3,60,992,8,60,1,61,1,61,3,61,
        996,8,61,1,61,3,61,999,8,61,1,61,3,61,1002,8,61,1,61,3,61,1005,8,
        61,1,61,3,61,1008,8,61,1,61,3,61,1011,8,61,1,61,3,61,1014,8,61,1,
        61,3,61,1017,8,61,1,61,3,61,1020,8,61,1,61,1,61,1,62,1,62,3,62,1026,
        8,62,1,62,3,62,1029,8,62,1,62,3,62,1032,8,62,1,62,1,62,3,62,1036,
        8,62,1,62,3,62,1039,8,62,3,62,1041,8,62,1,63,1,63,3,63,1045,8,63,
        1,63,1,63,3,63,1049,8,63,1,63,1,63,3,63,1053,8,63,1,63,3,63,1056,
        8,63,1,63,3,63,1059,8,63,1,63,5,63,1062,8,63,10,63,12,63,1065,9,
        63,1,64,1,64,3,64,1069,8,64,1,64,3,64,1072,8,64,1,64,3,64,1075,8,
        64,1,64,1,64,1,65,1,65,3,65,1081,8,65,1,65,1,65,3,65,1085,8,65,1,
        65,1,65,3,65,1089,8,65,1,65,3,65,1092,8,65,1,65,1,65,1,66,1,66,3,
        66,1098,8,66,1,66,1,66,3,66,1102,8,66,1,66,5,66,1105,8,66,10,66,
        12,66,1108,9,66,1,67,1,67,3,67,1112,8,67,1,67,1,67,3,67,1116,8,67,
        1,67,1,67,3,67,1120,8,67,3,67,1122,8,67,1,67,1,67,3,67,1126,8,67,
        1,67,1,67,1,67,1,67,3,67,1132,8,67,1,67,1,67,3,67,1136,8,67,1,67,
        1,67,3,67,1140,8,67,3,67,1142,8,67,1,67,3,67,1145,8,67,1,67,3,67,
        1148,8,67,1,67,1,67,3,67,1152,8,67,1,68,1,68,3,68,1156,8,68,1,68,
        1,68,3,68,1160,8,68,1,68,1,68,1,69,1,69,3,69,1166,8,69,1,69,1,69,
        3,69,1170,8,69,1,69,1,69,3,69,1174,8,69,1,69,1,69,1,70,1,70,3,70,
        1180,8,70,1,70,1,70,3,70,1184,8,70,1,70,1,70,3,70,1188,8,70,3,70,
        1190,8,70,1,70,1,70,3,70,1194,8,70,1,70,3,70,1197,8,70,1,70,3,70,
        1200,8,70,1,70,1,70,3,70,1204,8,70,1,70,1,70,3,70,1208,8,70,1,70,
        1,70,1,71,1,71,3,71,1214,8,71,1,71,4,71,1217,8,71,11,71,12,71,1218,
        1,72,1,72,3,72,1223,8,72,1,72,1,72,3,72,1227,8,72,1,72,1,72,3,72,
        1231,8,72,1,72,3,72,1234,8,72,1,72,3,72,1237,8,72,1,72,1,72,1,73,
        1,73,3,73,1243,8,73,1,73,1,73,3,73,1247,8,73,1,73,1,73,3,73,1251,
        8,73,1,73,3,73,1254,8,73,1,74,1,74,3,74,1258,8,74,1,74,1,74,3,74,
        1262,8,74,1,74,1,74,3,74,1266,8,74,1,74,1,74,1,75,1,75,3,75,1272,
        8,75,1,75,1,75,3,75,1276,8,75,1,75,5,75,1279,8,75,10,75,12,75,1282,
        9,75,1,76,1,76,3,76,1286,8,76,1,76,3,76,1289,8,76,1,76,3,76,1292,
        8,76,1,76,1,76,3,76,1296,8,76,1,76,1,76,3,76,1300,8,76,1,76,1,76,
        3,76,1304,8,76,1,76,1,76,4,76,1308,8,76,11,76,12,76,1309,1,76,3,
        76,1313,8,76,1,76,1,76,3,76,1317,8,76,1,76,3,76,1320,8,76,1,76,3,
        76,1323,8,76,1,76,1,76,1,77,1,77,1,77,3,77,1330,8,77,1,78,1,78,1,
        78,1,78,1,78,1,78,1,78,3,78,1339,8,78,1,79,1,79,1,80,1,80,1,81,1,
        81,1,82,1,82,1,83,1,83,3,83,1351,8,83,1,83,3,83,1354,8,83,1,83,3,
        83,1357,8,83,1,83,1,83,1,84,1,84,3,84,1363,8,84,1,84,1,84,3,84,1367,
        8,84,1,84,1,84,3,84,1371,8,84,1,84,5,84,1374,8,84,10,84,12,84,1377,
        9,84,3,84,1379,8,84,1,84,3,84,1382,8,84,1,84,1,84,1,85,1,85,3,85,
        1388,8,85,1,85,1,85,3,85,1392,8,85,1,85,1,85,1,86,1,86,3,86,1398,
        8,86,1,87,1,87,1,88,1,88,1,88,0,0,89,0,2,4,6,8,10,12,14,16,18,20,
        22,24,26,28,30,32,34,36,38,40,42,44,46,48,50,52,54,56,58,60,62,64,
        66,68,70,72,74,76,78,80,82,84,86,88,90,92,94,96,98,100,102,104,106,
        108,110,112,114,116,118,120,122,124,126,128,130,132,134,136,138,
        140,142,144,146,148,150,152,154,156,158,160,162,164,166,168,170,
        172,174,176,0,10,2,0,37,38,42,43,2,0,40,40,47,47,1,0,1,2,2,0,1,1,
        3,7,1,0,18,19,2,0,20,21,23,23,1,0,33,36,1,0,71,72,4,0,30,35,89,89,
        92,93,95,95,1,0,36,88,1627,0,179,1,0,0,0,2,195,1,0,0,0,4,197,1,0,
        0,0,6,206,1,0,0,0,8,208,1,0,0,0,10,232,1,0,0,0,12,238,1,0,0,0,14,
        249,1,0,0,0,16,255,1,0,0,0,18,265,1,0,0,0,20,291,1,0,0,0,22,306,
        1,0,0,0,24,317,1,0,0,0,26,324,1,0,0,0,28,352,1,0,0,0,30,378,1,0,
        0,0,32,398,1,0,0,0,34,406,1,0,0,0,36,423,1,0,0,0,38,430,1,0,0,0,
        40,434,1,0,0,0,42,442,1,0,0,0,44,467,1,0,0,0,46,469,1,0,0,0,48,488,
        1,0,0,0,50,500,1,0,0,0,52,528,1,0,0,0,54,532,1,0,0,0,56,546,1,0,
        0,0,58,556,1,0,0,0,60,600,1,0,0,0,62,607,1,0,0,0,64,611,1,0,0,0,
        66,617,1,0,0,0,68,624,1,0,0,0,70,630,1,0,0,0,72,644,1,0,0,0,74,658,
        1,0,0,0,76,672,1,0,0,0,78,692,1,0,0,0,80,697,1,0,0,0,82,712,1,0,
        0,0,84,714,1,0,0,0,86,728,1,0,0,0,88,742,1,0,0,0,90,757,1,0,0,0,
        92,764,1,0,0,0,94,810,1,0,0,0,96,812,1,0,0,0,98,829,1,0,0,0,100,
        832,1,0,0,0,102,846,1,0,0,0,104,853,1,0,0,0,106,875,1,0,0,0,108,
        900,1,0,0,0,110,902,1,0,0,0,112,910,1,0,0,0,114,912,1,0,0,0,116,
        948,1,0,0,0,118,950,1,0,0,0,120,991,1,0,0,0,122,993,1,0,0,0,124,
        1023,1,0,0,0,126,1042,1,0,0,0,128,1066,1,0,0,0,130,1078,1,0,0,0,
        132,1095,1,0,0,0,134,1151,1,0,0,0,136,1153,1,0,0,0,138,1163,1,0,
        0,0,140,1177,1,0,0,0,142,1211,1,0,0,0,144,1220,1,0,0,0,146,1240,
        1,0,0,0,148,1255,1,0,0,0,150,1269,1,0,0,0,152,1283,1,0,0,0,154,1326,
        1,0,0,0,156,1338,1,0,0,0,158,1340,1,0,0,0,160,1342,1,0,0,0,162,1344,
        1,0,0,0,164,1346,1,0,0,0,166,1348,1,0,0,0,168,1360,1,0,0,0,170,1385,
        1,0,0,0,172,1397,1,0,0,0,174,1399,1,0,0,0,176,1401,1,0,0,0,178,180,
        5,99,0,0,179,178,1,0,0,0,179,180,1,0,0,0,180,181,1,0,0,0,181,183,
        3,2,1,0,182,184,5,99,0,0,183,182,1,0,0,0,183,184,1,0,0,0,184,186,
        1,0,0,0,185,187,5,9,0,0,186,185,1,0,0,0,186,187,1,0,0,0,187,189,
        1,0,0,0,188,190,5,99,0,0,189,188,1,0,0,0,189,190,1,0,0,0,190,191,
        1,0,0,0,191,192,5,0,0,1,192,1,1,0,0,0,193,196,3,4,2,0,194,196,3,
        8,4,0,195,193,1,0,0,0,195,194,1,0,0,0,196,3,1,0,0,0,197,201,3,6,
        3,0,198,200,3,128,64,0,199,198,1,0,0,0,200,203,1,0,0,0,201,199,1,
        0,0,0,201,202,1,0,0,0,202,5,1,0,0,0,203,201,1,0,0,0,204,207,3,28,
        14,0,205,207,3,30,15,0,206,204,1,0,0,0,206,205,1,0,0,0,207,7,1,0,
        0,0,208,210,5,28,0,0,209,211,5,99,0,0,210,209,1,0,0,0,210,211,1,
        0,0,0,211,212,1,0,0,0,212,214,3,132,66,0,213,215,5,99,0,0,214,213,
        1,0,0,0,214,215,1,0,0,0,215,217,1,0,0,0,216,218,3,48,24,0,217,216,
        1,0,0,0,217,218,1,0,0,0,218,230,1,0,0,0,219,221,5,99,0,0,220,219,
        1,0,0,0,220,221,1,0,0,0,221,222,1,0,0,0,222,224,5,29,0,0,223,225,
        5,99,0,0,224,223,1,0,0,0,224,225,1,0,0,0,225,228,1,0,0,0,226,229,
        5,23,0,0,227,229,3,50,25,0,228,226,1,0,0,0,228,227,1,0,0,0,229,231,
        1,0,0,0,230,220,1,0,0,0,230,231,1,0,0,0,231,9,1,0,0,0,232,234,5,
        53,0,0,233,235,5,99,0,0,234,233,1,0,0,0,234,235,1,0,0,0,235,236,
        1,0,0,0,236,237,3,18,9,0,237,11,1,0,0,0,238,240,5,57,0,0,239,241,
        5,99,0,0,240,239,1,0,0,0,240,241,1,0,0,0,241,242,1,0,0,0,242,247,
        3,18,9,0,243,245,5,99,0,0,244,243,1,0,0,0,244,245,1,0,0,0,245,246,
        1,0,0,0,246,248,3,68,34,0,247,244,1,0,0,0,247,248,1,0,0,0,248,13,
        1,0,0,0,249,251,5,55,0,0,250,252,5,99,0,0,251,250,1,0,0,0,251,252,
        1,0,0,0,252,253,1,0,0,0,253,254,3,72,36,0,254,15,1,0,0,0,255,257,
        5,46,0,0,256,258,5,99,0,0,257,256,1,0,0,0,257,258,1,0,0,0,258,259,
        1,0,0,0,259,260,3,72,36,0,260,17,1,0,0,0,261,263,5,99,0,0,262,261,
        1,0,0,0,262,263,1,0,0,0,263,264,1,0,0,0,264,266,5,63,0,0,265,262,
        1,0,0,0,265,266,1,0,0,0,266,268,1,0,0,0,267,269,5,99,0,0,268,267,
        1,0,0,0,268,269,1,0,0,0,269,270,1,0,0,0,270,275,3,20,10,0,271,273,
        5,99,0,0,272,271,1,0,0,0,272,273,1,0,0,0,273,274,1,0,0,0,274,276,
        3,26,13,0,275,272,1,0,0,0,275,276,1,0,0,0,276,281,1,0,0,0,277,279,
        5,99,0,0,278,277,1,0,0,0,278,279,1,0,0,0,279,280,1,0,0,0,280,282,
        3,14,7,0,281,278,1,0,0,0,281,282,1,0,0,0,282,287,1,0,0,0,283,285,
        5,99,0,0,284,283,1,0,0,0,284,285,1,0,0,0,285,286,1,0,0,0,286,288,
        3,16,8,0,287,284,1,0,0,0,287,288,1,0,0,0,288,19,1,0,0,0,289,292,
        5,23,0,0,290,292,3,22,11,0,291,289,1,0,0,0,291,290,1,0,0,0,292,303,
        1,0,0,0,293,295,5,99,0,0,294,293,1,0,0,0,294,295,1,0,0,0,295,296,
        1,0,0,0,296,298,5,11,0,0,297,299,5,99,0,0,298,297,1,0,0,0,298,299,
        1,0,0,0,299,300,1,0,0,0,300,302,3,22,11,0,301,294,1,0,0,0,302,305,
        1,0,0,0,303,301,1,0,0,0,303,304,1,0,0,0,304,21,1,0,0,0,305,303,1,
        0,0,0,306,315,3,72,36,0,307,309,5,99,0,0,308,307,1,0,0,0,308,309,
        1,0,0,0,309,310,1,0,0,0,310,312,5,61,0,0,311,313,5,99,0,0,312,311,
        1,0,0,0,312,313,1,0,0,0,313,314,1,0,0,0,314,316,3,174,87,0,315,308,
        1,0,0,0,315,316,1,0,0,0,316,23,1,0,0,0,317,322,3,72,36,0,318,320,
        5,99,0,0,319,318,1,0,0,0,319,320,1,0,0,0,320,321,1,0,0,0,321,323,
        7,0,0,0,322,319,1,0,0,0,322,323,1,0,0,0,323,25,1,0,0,0,324,326,5,
        51,0,0,325,327,5,99,0,0,326,325,1,0,0,0,326,327,1,0,0,0,327,328,
        1,0,0,0,328,330,5,39,0,0,329,331,5,99,0,0,330,329,1,0,0,0,330,331,
        1,0,0,0,331,332,1,0,0,0,332,343,3,24,12,0,333,335,5,99,0,0,334,333,
        1,0,0,0,334,335,1,0,0,0,335,336,1,0,0,0,336,338,5,11,0,0,337,339,
        5,99,0,0,338,337,1,0,0,0,338,339,1,0,0,0,339,340,1,0,0,0,340,342,
        3,24,12,0,341,334,1,0,0,0,342,345,1,0,0,0,343,341,1,0,0,0,343,344,
        1,0,0,0,344,27,1,0,0,0,345,343,1,0,0,0,346,348,3,36,18,0,347,349,
        5,99,0,0,348,347,1,0,0,0,348,349,1,0,0,0,349,351,1,0,0,0,350,346,
        1,0,0,0,351,354,1,0,0,0,352,350,1,0,0,0,352,353,1,0,0,0,353,370,
        1,0,0,0,354,352,1,0,0,0,355,371,3,10,5,0,356,358,3,38,19,0,357,359,
        5,99,0,0,358,357,1,0,0,0,358,359,1,0,0,0,359,361,1,0,0,0,360,356,
        1,0,0,0,361,362,1,0,0,0,362,360,1,0,0,0,362,363,1,0,0,0,363,368,
        1,0,0,0,364,366,5,99,0,0,365,364,1,0,0,0,365,366,1,0,0,0,366,367,
        1,0,0,0,367,369,3,10,5,0,368,365,1,0,0,0,368,369,1,0,0,0,369,371,
        1,0,0,0,370,355,1,0,0,0,370,360,1,0,0,0,371,29,1,0,0,0,372,374,3,
        36,18,0,373,375,5,99,0,0,374,373,1,0,0,0,374,375,1,0,0,0,375,377,
        1,0,0,0,376,372,1,0,0,0,377,380,1,0,0,0,378,376,1,0,0,0,378,379,
        1,0,0,0,379,387,1,0,0,0,380,378,1,0,0,0,381,383,3,38,19,0,382,384,
        5,99,0,0,383,382,1,0,0,0,383,384,1,0,0,0,384,386,1,0,0,0,385,381,
        1,0,0,0,386,389,1,0,0,0,387,385,1,0,0,0,387,388,1,0,0,0,388,390,
        1,0,0,0,389,387,1,0,0,0,390,392,3,12,6,0,391,393,5,99,0,0,392,391,
        1,0,0,0,392,393,1,0,0,0,393,394,1,0,0,0,394,395,3,28,14,0,395,31,
        1,0,0,0,396,397,5,50,0,0,397,399,5,99,0,0,398,396,1,0,0,0,398,399,
        1,0,0,0,399,400,1,0,0,0,400,402,5,47,0,0,401,403,5,99,0,0,402,401,
        1,0,0,0,402,403,1,0,0,0,403,404,1,0,0,0,404,405,3,66,33,0,405,33,
        1,0,0,0,406,408,5,59,0,0,407,409,5,99,0,0,408,407,1,0,0,0,408,409,
        1,0,0,0,409,410,1,0,0,0,410,412,3,72,36,0,411,413,5,99,0,0,412,411,
        1,0,0,0,412,413,1,0,0,0,413,414,1,0,0,0,414,416,5,61,0,0,415,417,
        5,99,0,0,416,415,1,0,0,0,416,417,1,0,0,0,417,418,1,0,0,0,418,419,
        3,174,87,0,419,35,1,0,0,0,420,424,3,32,16,0,421,424,3,34,17,0,422,
        424,3,46,23,0,423,420,1,0,0,0,423,421,1,0,0,0,423,422,1,0,0,0,424,
        37,1,0,0,0,425,431,3,64,32,0,426,431,3,54,27,0,427,431,3,40,20,0,
        428,431,3,58,29,0,429,431,3,42,21,0,430,425,1,0,0,0,430,426,1,0,
        0,0,430,427,1,0,0,0,430,428,1,0,0,0,430,429,1,0,0,0,431,39,1,0,0,
        0,432,433,5,44,0,0,433,435,5,99,0,0,434,432,1,0,0,0,434,435,1,0,
        0,0,435,436,1,0,0,0,436,438,5,41,0,0,437,439,5,99,0,0,438,437,1,
        0,0,0,438,439,1,0,0,0,439,440,1,0,0,0,440,441,3,150,75,0,441,41,
        1,0,0,0,442,444,5,52,0,0,443,445,5,99,0,0,444,443,1,0,0,0,444,445,
        1,0,0,0,445,446,1,0,0,0,446,457,3,44,22,0,447,449,5,99,0,0,448,447,
        1,0,0,0,448,449,1,0,0,0,449,450,1,0,0,0,450,452,5,11,0,0,451,453,
        5,99,0,0,452,451,1,0,0,0,452,453,1,0,0,0,453,454,1,0,0,0,454,456,
        3,44,22,0,455,448,1,0,0,0,456,459,1,0,0,0,457,455,1,0,0,0,457,458,
        1,0,0,0,458,43,1,0,0,0,459,457,1,0,0,0,460,462,3,174,87,0,461,463,
        5,99,0,0,462,461,1,0,0,0,462,463,1,0,0,0,463,464,1,0,0,0,464,465,
        3,62,31,0,465,468,1,0,0,0,466,468,3,104,52,0,467,460,1,0,0,0,467,
        466,1,0,0,0,468,45,1,0,0,0,469,471,5,28,0,0,470,472,5,99,0,0,471,
        470,1,0,0,0,471,472,1,0,0,0,472,473,1,0,0,0,473,475,3,132,66,0,474,
        476,5,99,0,0,475,474,1,0,0,0,475,476,1,0,0,0,476,477,1,0,0,0,477,
        486,3,48,24,0,478,480,5,99,0,0,479,478,1,0,0,0,479,480,1,0,0,0,480,
        481,1,0,0,0,481,483,5,29,0,0,482,484,5,99,0,0,483,482,1,0,0,0,483,
        484,1,0,0,0,484,485,1,0,0,0,485,487,3,50,25,0,486,479,1,0,0,0,486,
        487,1,0,0,0,487,47,1,0,0,0,488,490,5,12,0,0,489,491,5,99,0,0,490,
        489,1,0,0,0,490,491,1,0,0,0,491,493,1,0,0,0,492,494,3,150,75,0,493,
        492,1,0,0,0,493,494,1,0,0,0,494,496,1,0,0,0,495,497,5,99,0,0,496,
        495,1,0,0,0,496,497,1,0,0,0,497,498,1,0,0,0,498,499,5,13,0,0,499,
        49,1,0,0,0,500,511,3,52,26,0,501,503,5,99,0,0,502,501,1,0,0,0,502,
        503,1,0,0,0,503,504,1,0,0,0,504,506,5,11,0,0,505,507,5,99,0,0,506,
        505,1,0,0,0,506,507,1,0,0,0,507,508,1,0,0,0,508,510,3,52,26,0,509,
        502,1,0,0,0,510,513,1,0,0,0,511,509,1,0,0,0,511,512,1,0,0,0,512,
        518,1,0,0,0,513,511,1,0,0,0,514,516,5,99,0,0,515,514,1,0,0,0,515,
        516,1,0,0,0,516,517,1,0,0,0,517,519,3,68,34,0,518,515,1,0,0,0,518,
        519,1,0,0,0,519,51,1,0,0,0,520,522,3,174,87,0,521,523,5,99,0,0,522,
        521,1,0,0,0,522,523,1,0,0,0,523,524,1,0,0,0,524,526,5,61,0,0,525,
        527,5,99,0,0,526,525,1,0,0,0,526,527,1,0,0,0,527,529,1,0,0,0,528,
        520,1,0,0,0,528,529,1,0,0,0,529,530,1,0,0,0,530,531,3,174,87,0,531,
        53,1,0,0,0,532,534,5,48,0,0,533,535,5,99,0,0,534,533,1,0,0,0,534,
        535,1,0,0,0,535,536,1,0,0,0,536,543,3,106,53,0,537,539,5,99,0,0,
        538,537,1,0,0,0,538,539,1,0,0,0,539,540,1,0,0,0,540,542,3,56,28,
        0,541,538,1,0,0,0,542,545,1,0,0,0,543,541,1,0,0,0,543,544,1,0,0,
        0,544,55,1,0,0,0,545,543,1,0,0,0,546,548,5,49,0,0,547,549,5,99,0,
        0,548,547,1,0,0,0,548,549,1,0,0,0,549,550,1,0,0,0,550,552,7,1,0,
        0,551,553,5,99,0,0,552,551,1,0,0,0,552,553,1,0,0,0,553,554,1,0,0,
        0,554,555,3,58,29,0,555,57,1,0,0,0,556,558,5,54,0,0,557,559,5,99,
        0,0,558,557,1,0,0,0,558,559,1,0,0,0,559,560,1,0,0,0,560,571,3,60,
        30,0,561,563,5,99,0,0,562,561,1,0,0,0,562,563,1,0,0,0,563,564,1,
        0,0,0,564,566,5,11,0,0,565,567,5,99,0,0,566,565,1,0,0,0,566,567,
        1,0,0,0,567,568,1,0,0,0,568,570,3,60,30,0,569,562,1,0,0,0,570,573,
        1,0,0,0,571,569,1,0,0,0,571,572,1,0,0,0,572,59,1,0,0,0,573,571,1,
        0,0,0,574,576,3,104,52,0,575,577,5,99,0,0,576,575,1,0,0,0,576,577,
        1,0,0,0,577,578,1,0,0,0,578,580,5,1,0,0,579,581,5,99,0,0,580,579,
        1,0,0,0,580,581,1,0,0,0,581,582,1,0,0,0,582,583,3,72,36,0,583,601,
        1,0,0,0,584,586,3,174,87,0,585,587,5,99,0,0,586,585,1,0,0,0,586,
        587,1,0,0,0,587,588,1,0,0,0,588,590,7,2,0,0,589,591,5,99,0,0,590,
        589,1,0,0,0,590,591,1,0,0,0,591,592,1,0,0,0,592,593,3,72,36,0,593,
        601,1,0,0,0,594,596,3,174,87,0,595,597,5,99,0,0,596,595,1,0,0,0,
        596,597,1,0,0,0,597,598,1,0,0,0,598,599,3,62,31,0,599,601,1,0,0,
        0,600,574,1,0,0,0,600,584,1,0,0,0,600,594,1,0,0,0,601,61,1,0,0,0,
        602,604,5,25,0,0,603,605,5,99,0,0,604,603,1,0,0,0,604,605,1,0,0,
        0,605,606,1,0,0,0,606,608,3,172,86,0,607,602,1,0,0,0,608,609,1,0,
        0,0,609,607,1,0,0,0,609,610,1,0,0,0,610,63,1,0,0,0,611,613,5,40,
        0,0,612,614,5,99,0,0,613,612,1,0,0,0,613,614,1,0,0,0,614,615,1,0,
        0,0,615,616,3,70,35,0,616,65,1,0,0,0,617,622,3,70,35,0,618,620,5,
        99,0,0,619,618,1,0,0,0,619,620,1,0,0,0,620,621,1,0,0,0,621,623,3,
        68,34,0,622,619,1,0,0,0,622,623,1,0,0,0,623,67,1,0,0,0,624,626,5,
        56,0,0,625,627,5,99,0,0,626,625,1,0,0,0,626,627,1,0,0,0,627,628,
        1,0,0,0,628,629,3,72,36,0,629,69,1,0,0,0,630,641,3,106,53,0,631,
        633,5,99,0,0,632,631,1,0,0,0,632,633,1,0,0,0,633,634,1,0,0,0,634,
        636,5,11,0,0,635,637,5,99,0,0,636,635,1,0,0,0,636,637,1,0,0,0,637,
        638,1,0,0,0,638,640,3,106,53,0,639,632,1,0,0,0,640,643,1,0,0,0,641,
        639,1,0,0,0,641,642,1,0,0,0,642,71,1,0,0,0,643,641,1,0,0,0,644,655,
        3,74,37,0,645,647,5,99,0,0,646,645,1,0,0,0,646,647,1,0,0,0,647,648,
        1,0,0,0,648,650,5,68,0,0,649,651,5,99,0,0,650,649,1,0,0,0,650,651,
        1,0,0,0,651,652,1,0,0,0,652,654,3,74,37,0,653,646,1,0,0,0,654,657,
        1,0,0,0,655,653,1,0,0,0,655,656,1,0,0,0,656,73,1,0,0,0,657,655,1,
        0,0,0,658,669,3,76,38,0,659,661,5,99,0,0,660,659,1,0,0,0,660,661,
        1,0,0,0,661,662,1,0,0,0,662,664,5,70,0,0,663,665,5,99,0,0,664,663,
        1,0,0,0,664,665,1,0,0,0,665,666,1,0,0,0,666,668,3,76,38,0,667,660,
        1,0,0,0,668,671,1,0,0,0,669,667,1,0,0,0,669,670,1,0,0,0,670,75,1,
        0,0,0,671,669,1,0,0,0,672,683,3,78,39,0,673,675,5,99,0,0,674,673,
        1,0,0,0,674,675,1,0,0,0,675,676,1,0,0,0,676,678,5,60,0,0,677,679,
        5,99,0,0,678,677,1,0,0,0,678,679,1,0,0,0,679,680,1,0,0,0,680,682,
        3,78,39,0,681,674,1,0,0,0,682,685,1,0,0,0,683,681,1,0,0,0,683,684,
        1,0,0,0,684,77,1,0,0,0,685,683,1,0,0,0,686,688,5,67,0,0,687,689,
        5,99,0,0,688,687,1,0,0,0,688,689,1,0,0,0,689,691,1,0,0,0,690,686,
        1,0,0,0,691,694,1,0,0,0,692,690,1,0,0,0,692,693,1,0,0,0,693,695,
        1,0,0,0,694,692,1,0,0,0,695,696,3,80,40,0,696,79,1,0,0,0,697,709,
        3,84,42,0,698,700,5,99,0,0,699,698,1,0,0,0,699,700,1,0,0,0,700,701,
        1,0,0,0,701,703,3,82,41,0,702,704,5,99,0,0,703,702,1,0,0,0,703,704,
        1,0,0,0,704,705,1,0,0,0,705,706,3,84,42,0,706,708,1,0,0,0,707,699,
        1,0,0,0,708,711,1,0,0,0,709,707,1,0,0,0,709,710,1,0,0,0,710,81,1,
        0,0,0,711,709,1,0,0,0,712,713,7,3,0,0,713,83,1,0,0,0,714,725,3,86,
        43,0,715,717,5,99,0,0,716,715,1,0,0,0,716,717,1,0,0,0,717,718,1,
        0,0,0,718,720,7,4,0,0,719,721,5,99,0,0,720,719,1,0,0,0,720,721,1,
        0,0,0,721,722,1,0,0,0,722,724,3,86,43,0,723,716,1,0,0,0,724,727,
        1,0,0,0,725,723,1,0,0,0,725,726,1,0,0,0,726,85,1,0,0,0,727,725,1,
        0,0,0,728,739,3,88,44,0,729,731,5,99,0,0,730,729,1,0,0,0,730,731,
        1,0,0,0,731,732,1,0,0,0,732,734,7,5,0,0,733,735,5,99,0,0,734,733,
        1,0,0,0,734,735,1,0,0,0,735,736,1,0,0,0,736,738,3,88,44,0,737,730,
        1,0,0,0,738,741,1,0,0,0,739,737,1,0,0,0,739,740,1,0,0,0,740,87,1,
        0,0,0,741,739,1,0,0,0,742,753,3,90,45,0,743,745,5,99,0,0,744,743,
        1,0,0,0,744,745,1,0,0,0,745,746,1,0,0,0,746,748,5,22,0,0,747,749,
        5,99,0,0,748,747,1,0,0,0,748,749,1,0,0,0,749,750,1,0,0,0,750,752,
        3,90,45,0,751,744,1,0,0,0,752,755,1,0,0,0,753,751,1,0,0,0,753,754,
        1,0,0,0,754,89,1,0,0,0,755,753,1,0,0,0,756,758,7,4,0,0,757,756,1,
        0,0,0,757,758,1,0,0,0,758,760,1,0,0,0,759,761,5,99,0,0,760,759,1,
        0,0,0,760,761,1,0,0,0,761,762,1,0,0,0,762,763,3,92,46,0,763,91,1,
        0,0,0,764,775,3,102,51,0,765,767,5,99,0,0,766,765,1,0,0,0,766,767,
        1,0,0,0,767,771,1,0,0,0,768,772,3,96,48,0,769,772,3,94,47,0,770,
        772,3,100,50,0,771,768,1,0,0,0,771,769,1,0,0,0,771,770,1,0,0,0,772,
        774,1,0,0,0,773,766,1,0,0,0,774,777,1,0,0,0,775,773,1,0,0,0,775,
        776,1,0,0,0,776,93,1,0,0,0,777,775,1,0,0,0,778,780,5,99,0,0,779,
        778,1,0,0,0,779,780,1,0,0,0,780,781,1,0,0,0,781,783,5,65,0,0,782,
        784,5,99,0,0,783,782,1,0,0,0,783,784,1,0,0,0,784,785,1,0,0,0,785,
        811,3,102,51,0,786,788,5,16,0,0,787,789,5,99,0,0,788,787,1,0,0,0,
        788,789,1,0,0,0,789,804,1,0,0,0,790,792,3,72,36,0,791,790,1,0,0,
        0,791,792,1,0,0,0,792,794,1,0,0,0,793,795,5,99,0,0,794,793,1,0,0,
        0,794,795,1,0,0,0,795,796,1,0,0,0,796,798,5,8,0,0,797,799,5,99,0,
        0,798,797,1,0,0,0,798,799,1,0,0,0,799,801,1,0,0,0,800,802,3,72,36,
        0,801,800,1,0,0,0,801,802,1,0,0,0,802,805,1,0,0,0,803,805,3,72,36,
        0,804,791,1,0,0,0,804,803,1,0,0,0,805,807,1,0,0,0,806,808,5,99,0,
        0,807,806,1,0,0,0,807,808,1,0,0,0,808,809,1,0,0,0,809,811,5,17,0,
        0,810,779,1,0,0,0,810,786,1,0,0,0,811,95,1,0,0,0,812,814,3,98,49,
        0,813,815,5,99,0,0,814,813,1,0,0,0,814,815,1,0,0,0,815,816,1,0,0,
        0,816,817,3,102,51,0,817,97,1,0,0,0,818,820,5,69,0,0,819,821,5,99,
        0,0,820,819,1,0,0,0,820,821,1,0,0,0,821,822,1,0,0,0,822,830,5,57,
        0,0,823,825,5,64,0,0,824,826,5,99,0,0,825,824,1,0,0,0,825,826,1,
        0,0,0,826,827,1,0,0,0,827,830,5,57,0,0,828,830,5,62,0,0,829,818,
        1,0,0,0,829,823,1,0,0,0,829,828,1,0,0,0,830,99,1,0,0,0,831,833,5,
        99,0,0,832,831,1,0,0,0,832,833,1,0,0,0,833,834,1,0,0,0,834,836,5,
        66,0,0,835,837,5,99,0,0,836,835,1,0,0,0,836,837,1,0,0,0,837,839,
        1,0,0,0,838,840,5,67,0,0,839,838,1,0,0,0,839,840,1,0,0,0,840,842,
        1,0,0,0,841,843,5,99,0,0,842,841,1,0,0,0,842,843,1,0,0,0,843,844,
        1,0,0,0,844,845,5,73,0,0,845,101,1,0,0,0,846,851,3,104,52,0,847,
        849,5,99,0,0,848,847,1,0,0,0,848,849,1,0,0,0,849,850,1,0,0,0,850,
        852,3,62,31,0,851,848,1,0,0,0,851,852,1,0,0,0,852,103,1,0,0,0,853,
        864,3,116,58,0,854,856,5,99,0,0,855,854,1,0,0,0,855,856,1,0,0,0,
        856,857,1,0,0,0,857,859,5,10,0,0,858,860,5,99,0,0,859,858,1,0,0,
        0,859,860,1,0,0,0,860,861,1,0,0,0,861,863,3,172,86,0,862,855,1,0,
        0,0,863,866,1,0,0,0,864,862,1,0,0,0,864,865,1,0,0,0,865,105,1,0,
        0,0,866,864,1,0,0,0,867,869,3,174,87,0,868,870,5,99,0,0,869,868,
        1,0,0,0,869,870,1,0,0,0,870,871,1,0,0,0,871,873,5,1,0,0,872,874,
        5,99,0,0,873,872,1,0,0,0,873,874,1,0,0,0,874,876,1,0,0,0,875,867,
        1,0,0,0,875,876,1,0,0,0,876,877,1,0,0,0,877,878,3,108,54,0,878,107,
        1,0,0,0,879,886,3,114,57,0,880,882,5,99,0,0,881,880,1,0,0,0,881,
        882,1,0,0,0,882,883,1,0,0,0,883,885,3,110,55,0,884,881,1,0,0,0,885,
        888,1,0,0,0,886,884,1,0,0,0,886,887,1,0,0,0,887,901,1,0,0,0,888,
        886,1,0,0,0,889,891,5,12,0,0,890,892,5,99,0,0,891,890,1,0,0,0,891,
        892,1,0,0,0,892,893,1,0,0,0,893,895,3,108,54,0,894,896,5,99,0,0,
        895,894,1,0,0,0,895,896,1,0,0,0,896,897,1,0,0,0,897,898,5,13,0,0,
        898,901,1,0,0,0,899,901,3,134,67,0,900,879,1,0,0,0,900,889,1,0,0,
        0,900,899,1,0,0,0,901,109,1,0,0,0,902,904,3,120,60,0,903,905,5,99,
        0,0,904,903,1,0,0,0,904,905,1,0,0,0,905,906,1,0,0,0,906,907,3,114,
        57,0,907,111,1,0,0,0,908,911,3,168,84,0,909,911,3,154,77,0,910,908,
        1,0,0,0,910,909,1,0,0,0,911,113,1,0,0,0,912,914,5,12,0,0,913,915,
        5,99,0,0,914,913,1,0,0,0,914,915,1,0,0,0,915,917,1,0,0,0,916,918,
        3,174,87,0,917,916,1,0,0,0,917,918,1,0,0,0,918,920,1,0,0,0,919,921,
        5,99,0,0,920,919,1,0,0,0,920,921,1,0,0,0,921,923,1,0,0,0,922,924,
        3,62,31,0,923,922,1,0,0,0,923,924,1,0,0,0,924,926,1,0,0,0,925,927,
        5,99,0,0,926,925,1,0,0,0,926,927,1,0,0,0,927,929,1,0,0,0,928,930,
        3,112,56,0,929,928,1,0,0,0,929,930,1,0,0,0,930,932,1,0,0,0,931,933,
        5,99,0,0,932,931,1,0,0,0,932,933,1,0,0,0,933,934,1,0,0,0,934,935,
        5,13,0,0,935,115,1,0,0,0,936,949,3,156,78,0,937,949,3,154,77,0,938,
        949,3,152,76,0,939,949,3,148,74,0,940,949,3,144,72,0,941,949,3,140,
        70,0,942,949,3,138,69,0,943,949,3,142,71,0,944,949,3,136,68,0,945,
        949,3,134,67,0,946,949,3,174,87,0,947,949,3,130,65,0,948,936,1,0,
        0,0,948,937,1,0,0,0,948,938,1,0,0,0,948,939,1,0,0,0,948,940,1,0,
        0,0,948,941,1,0,0,0,948,942,1,0,0,0,948,943,1,0,0,0,948,944,1,0,
        0,0,948,945,1,0,0,0,948,946,1,0,0,0,948,947,1,0,0,0,949,117,1,0,
        0,0,950,951,3,174,87,0,951,952,5,1,0,0,952,119,1,0,0,0,953,955,5,
        6,0,0,954,956,5,99,0,0,955,954,1,0,0,0,955,956,1,0,0,0,956,957,1,
        0,0,0,957,959,5,18,0,0,958,960,5,99,0,0,959,958,1,0,0,0,959,960,
        1,0,0,0,960,962,1,0,0,0,961,963,3,122,61,0,962,961,1,0,0,0,962,963,
        1,0,0,0,963,965,1,0,0,0,964,966,5,99,0,0,965,964,1,0,0,0,965,966,
        1,0,0,0,966,967,1,0,0,0,967,969,5,18,0,0,968,970,5,99,0,0,969,968,
        1,0,0,0,969,970,1,0,0,0,970,972,1,0,0,0,971,973,5,5,0,0,972,971,
        1,0,0,0,972,973,1,0,0,0,973,992,1,0,0,0,974,976,5,18,0,0,975,977,
        5,99,0,0,976,975,1,0,0,0,976,977,1,0,0,0,977,979,1,0,0,0,978,980,
        3,122,61,0,979,978,1,0,0,0,979,980,1,0,0,0,980,982,1,0,0,0,981,983,
        5,99,0,0,982,981,1,0,0,0,982,983,1,0,0,0,983,984,1,0,0,0,984,986,
        5,18,0,0,985,987,5,99,0,0,986,985,1,0,0,0,986,987,1,0,0,0,987,989,
        1,0,0,0,988,990,5,5,0,0,989,988,1,0,0,0,989,990,1,0,0,0,990,992,
        1,0,0,0,991,953,1,0,0,0,991,974,1,0,0,0,992,121,1,0,0,0,993,995,
        5,16,0,0,994,996,5,99,0,0,995,994,1,0,0,0,995,996,1,0,0,0,996,998,
        1,0,0,0,997,999,3,174,87,0,998,997,1,0,0,0,998,999,1,0,0,0,999,1001,
        1,0,0,0,1000,1002,5,99,0,0,1001,1000,1,0,0,0,1001,1002,1,0,0,0,1002,
        1004,1,0,0,0,1003,1005,3,126,63,0,1004,1003,1,0,0,0,1004,1005,1,
        0,0,0,1005,1007,1,0,0,0,1006,1008,5,99,0,0,1007,1006,1,0,0,0,1007,
        1008,1,0,0,0,1008,1010,1,0,0,0,1009,1011,3,124,62,0,1010,1009,1,
        0,0,0,1010,1011,1,0,0,0,1011,1013,1,0,0,0,1012,1014,5,99,0,0,1013,
        1012,1,0,0,0,1013,1014,1,0,0,0,1014,1016,1,0,0,0,1015,1017,3,112,
        56,0,1016,1015,1,0,0,0,1016,1017,1,0,0,0,1017,1019,1,0,0,0,1018,
        1020,5,99,0,0,1019,1018,1,0,0,0,1019,1020,1,0,0,0,1020,1021,1,0,
        0,0,1021,1022,5,17,0,0,1022,123,1,0,0,0,1023,1025,5,23,0,0,1024,
        1026,5,99,0,0,1025,1024,1,0,0,0,1025,1026,1,0,0,0,1026,1028,1,0,
        0,0,1027,1029,5,92,0,0,1028,1027,1,0,0,0,1028,1029,1,0,0,0,1029,
        1040,1,0,0,0,1030,1032,5,99,0,0,1031,1030,1,0,0,0,1031,1032,1,0,
        0,0,1032,1033,1,0,0,0,1033,1035,5,8,0,0,1034,1036,5,99,0,0,1035,
        1034,1,0,0,0,1035,1036,1,0,0,0,1036,1038,1,0,0,0,1037,1039,5,92,
        0,0,1038,1037,1,0,0,0,1038,1039,1,0,0,0,1039,1041,1,0,0,0,1040,1031,
        1,0,0,0,1040,1041,1,0,0,0,1041,125,1,0,0,0,1042,1044,5,25,0,0,1043,
        1045,5,99,0,0,1044,1043,1,0,0,0,1044,1045,1,0,0,0,1045,1046,1,0,
        0,0,1046,1063,3,172,86,0,1047,1049,5,99,0,0,1048,1047,1,0,0,0,1048,
        1049,1,0,0,0,1049,1050,1,0,0,0,1050,1052,5,26,0,0,1051,1053,5,99,
        0,0,1052,1051,1,0,0,0,1052,1053,1,0,0,0,1053,1055,1,0,0,0,1054,1056,
        5,25,0,0,1055,1054,1,0,0,0,1055,1056,1,0,0,0,1056,1058,1,0,0,0,1057,
        1059,5,99,0,0,1058,1057,1,0,0,0,1058,1059,1,0,0,0,1059,1060,1,0,
        0,0,1060,1062,3,172,86,0,1061,1048,1,0,0,0,1062,1065,1,0,0,0,1063,
        1061,1,0,0,0,1063,1064,1,0,0,0,1064,127,1,0,0,0,1065,1063,1,0,0,
        0,1066,1068,5,58,0,0,1067,1069,5,99,0,0,1068,1067,1,0,0,0,1068,1069,
        1,0,0,0,1069,1071,1,0,0,0,1070,1072,5,36,0,0,1071,1070,1,0,0,0,1071,
        1072,1,0,0,0,1072,1074,1,0,0,0,1073,1075,5,99,0,0,1074,1073,1,0,
        0,0,1074,1075,1,0,0,0,1075,1076,1,0,0,0,1076,1077,3,6,3,0,1077,129,
        1,0,0,0,1078,1080,5,45,0,0,1079,1081,5,99,0,0,1080,1079,1,0,0,0,
        1080,1081,1,0,0,0,1081,1082,1,0,0,0,1082,1084,5,14,0,0,1083,1085,
        5,99,0,0,1084,1083,1,0,0,0,1084,1085,1,0,0,0,1085,1088,1,0,0,0,1086,
        1089,3,4,2,0,1087,1089,3,66,33,0,1088,1086,1,0,0,0,1088,1087,1,0,
        0,0,1089,1091,1,0,0,0,1090,1092,5,99,0,0,1091,1090,1,0,0,0,1091,
        1092,1,0,0,0,1092,1093,1,0,0,0,1093,1094,5,15,0,0,1094,131,1,0,0,
        0,1095,1106,3,174,87,0,1096,1098,5,99,0,0,1097,1096,1,0,0,0,1097,
        1098,1,0,0,0,1098,1099,1,0,0,0,1099,1101,5,10,0,0,1100,1102,5,99,
        0,0,1101,1100,1,0,0,0,1101,1102,1,0,0,0,1102,1103,1,0,0,0,1103,1105,
        3,174,87,0,1104,1097,1,0,0,0,1105,1108,1,0,0,0,1106,1104,1,0,0,0,
        1106,1107,1,0,0,0,1107,133,1,0,0,0,1108,1106,1,0,0,0,1109,1111,3,
        132,66,0,1110,1112,5,99,0,0,1111,1110,1,0,0,0,1111,1112,1,0,0,0,
        1112,1113,1,0,0,0,1113,1115,5,12,0,0,1114,1116,5,99,0,0,1115,1114,
        1,0,0,0,1115,1116,1,0,0,0,1116,1121,1,0,0,0,1117,1119,5,63,0,0,1118,
        1120,5,99,0,0,1119,1118,1,0,0,0,1119,1120,1,0,0,0,1120,1122,1,0,
        0,0,1121,1117,1,0,0,0,1121,1122,1,0,0,0,1122,1123,1,0,0,0,1123,1125,
        3,108,54,0,1124,1126,5,99,0,0,1125,1124,1,0,0,0,1125,1126,1,0,0,
        0,1126,1127,1,0,0,0,1127,1128,5,13,0,0,1128,1152,1,0,0,0,1129,1131,
        3,132,66,0,1130,1132,5,99,0,0,1131,1130,1,0,0,0,1131,1132,1,0,0,
        0,1132,1133,1,0,0,0,1133,1135,5,12,0,0,1134,1136,5,99,0,0,1135,1134,
        1,0,0,0,1135,1136,1,0,0,0,1136,1141,1,0,0,0,1137,1139,5,63,0,0,1138,
        1140,5,99,0,0,1139,1138,1,0,0,0,1139,1140,1,0,0,0,1140,1142,1,0,
        0,0,1141,1137,1,0,0,0,1141,1142,1,0,0,0,1142,1144,1,0,0,0,1143,1145,
        3,150,75,0,1144,1143,1,0,0,0,1144,1145,1,0,0,0,1145,1147,1,0,0,0,
        1146,1148,5,99,0,0,1147,1146,1,0,0,0,1147,1148,1,0,0,0,1148,1149,
        1,0,0,0,1149,1150,5,13,0,0,1150,1152,1,0,0,0,1151,1109,1,0,0,0,1151,
        1129,1,0,0,0,1152,135,1,0,0,0,1153,1155,5,12,0,0,1154,1156,5,99,
        0,0,1155,1154,1,0,0,0,1155,1156,1,0,0,0,1156,1157,1,0,0,0,1157,1159,
        3,72,36,0,1158,1160,5,99,0,0,1159,1158,1,0,0,0,1159,1160,1,0,0,0,
        1160,1161,1,0,0,0,1161,1162,5,13,0,0,1162,137,1,0,0,0,1163,1165,
        7,6,0,0,1164,1166,5,99,0,0,1165,1164,1,0,0,0,1165,1166,1,0,0,0,1166,
        1167,1,0,0,0,1167,1169,5,12,0,0,1168,1170,5,99,0,0,1169,1168,1,0,
        0,0,1169,1170,1,0,0,0,1170,1171,1,0,0,0,1171,1173,3,146,73,0,1172,
        1174,5,99,0,0,1173,1172,1,0,0,0,1173,1174,1,0,0,0,1174,1175,1,0,
        0,0,1175,1176,5,13,0,0,1176,139,1,0,0,0,1177,1179,5,16,0,0,1178,
        1180,5,99,0,0,1179,1178,1,0,0,0,1179,1180,1,0,0,0,1180,1189,1,0,
        0,0,1181,1183,3,118,59,0,1182,1184,5,99,0,0,1183,1182,1,0,0,0,1183,
        1184,1,0,0,0,1184,1185,1,0,0,0,1185,1187,5,1,0,0,1186,1188,5,99,
        0,0,1187,1186,1,0,0,0,1187,1188,1,0,0,0,1188,1190,1,0,0,0,1189,1181,
        1,0,0,0,1189,1190,1,0,0,0,1190,1191,1,0,0,0,1191,1196,3,142,71,0,
        1192,1194,5,99,0,0,1193,1192,1,0,0,0,1193,1194,1,0,0,0,1194,1195,
        1,0,0,0,1195,1197,3,68,34,0,1196,1193,1,0,0,0,1196,1197,1,0,0,0,
        1197,1199,1,0,0,0,1198,1200,5,99,0,0,1199,1198,1,0,0,0,1199,1200,
        1,0,0,0,1200,1201,1,0,0,0,1201,1203,5,26,0,0,1202,1204,5,99,0,0,
        1203,1202,1,0,0,0,1203,1204,1,0,0,0,1204,1205,1,0,0,0,1205,1207,
        3,72,36,0,1206,1208,5,99,0,0,1207,1206,1,0,0,0,1207,1208,1,0,0,0,
        1208,1209,1,0,0,0,1209,1210,5,17,0,0,1210,141,1,0,0,0,1211,1216,
        3,114,57,0,1212,1214,5,99,0,0,1213,1212,1,0,0,0,1213,1214,1,0,0,
        0,1214,1215,1,0,0,0,1215,1217,3,110,55,0,1216,1213,1,0,0,0,1217,
        1218,1,0,0,0,1218,1216,1,0,0,0,1218,1219,1,0,0,0,1219,143,1,0,0,
        0,1220,1222,5,16,0,0,1221,1223,5,99,0,0,1222,1221,1,0,0,0,1222,1223,
        1,0,0,0,1223,1224,1,0,0,0,1224,1233,3,146,73,0,1225,1227,5,99,0,
        0,1226,1225,1,0,0,0,1226,1227,1,0,0,0,1227,1228,1,0,0,0,1228,1230,
        5,26,0,0,1229,1231,5,99,0,0,1230,1229,1,0,0,0,1230,1231,1,0,0,0,
        1231,1232,1,0,0,0,1232,1234,3,72,36,0,1233,1226,1,0,0,0,1233,1234,
        1,0,0,0,1234,1236,1,0,0,0,1235,1237,5,99,0,0,1236,1235,1,0,0,0,1236,
        1237,1,0,0,0,1237,1238,1,0,0,0,1238,1239,5,17,0,0,1239,145,1,0,0,
        0,1240,1242,3,174,87,0,1241,1243,5,99,0,0,1242,1241,1,0,0,0,1242,
        1243,1,0,0,0,1243,1244,1,0,0,0,1244,1246,5,65,0,0,1245,1247,5,99,
        0,0,1246,1245,1,0,0,0,1246,1247,1,0,0,0,1247,1248,1,0,0,0,1248,1253,
        3,72,36,0,1249,1251,5,99,0,0,1250,1249,1,0,0,0,1250,1251,1,0,0,0,
        1251,1252,1,0,0,0,1252,1254,3,68,34,0,1253,1250,1,0,0,0,1253,1254,
        1,0,0,0,1254,147,1,0,0,0,1255,1257,5,32,0,0,1256,1258,5,99,0,0,1257,
        1256,1,0,0,0,1257,1258,1,0,0,0,1258,1259,1,0,0,0,1259,1261,5,12,
        0,0,1260,1262,5,99,0,0,1261,1260,1,0,0,0,1261,1262,1,0,0,0,1262,
        1263,1,0,0,0,1263,1265,5,23,0,0,1264,1266,5,99,0,0,1265,1264,1,0,
        0,0,1265,1266,1,0,0,0,1266,1267,1,0,0,0,1267,1268,5,13,0,0,1268,
        149,1,0,0,0,1269,1280,3,72,36,0,1270,1272,5,99,0,0,1271,1270,1,0,
        0,0,1271,1272,1,0,0,0,1272,1273,1,0,0,0,1273,1275,5,11,0,0,1274,
        1276,5,99,0,0,1275,1274,1,0,0,0,1275,1276,1,0,0,0,1276,1277,1,0,
        0,0,1277,1279,3,72,36,0,1278,1271,1,0,0,0,1279,1282,1,0,0,0,1280,
        1278,1,0,0,0,1280,1281,1,0,0,0,1281,151,1,0,0,0,1282,1280,1,0,0,
        0,1283,1285,5,79,0,0,1284,1286,5,99,0,0,1285,1284,1,0,0,0,1285,1286,
        1,0,0,0,1286,1288,1,0,0,0,1287,1289,3,72,36,0,1288,1287,1,0,0,0,
        1288,1289,1,0,0,0,1289,1307,1,0,0,0,1290,1292,5,99,0,0,1291,1290,
        1,0,0,0,1291,1292,1,0,0,0,1292,1293,1,0,0,0,1293,1295,5,80,0,0,1294,
        1296,5,99,0,0,1295,1294,1,0,0,0,1295,1296,1,0,0,0,1296,1297,1,0,
        0,0,1297,1299,3,72,36,0,1298,1300,5,99,0,0,1299,1298,1,0,0,0,1299,
        1300,1,0,0,0,1300,1301,1,0,0,0,1301,1303,5,81,0,0,1302,1304,5,99,
        0,0,1303,1302,1,0,0,0,1303,1304,1,0,0,0,1304,1305,1,0,0,0,1305,1306,
        3,72,36,0,1306,1308,1,0,0,0,1307,1291,1,0,0,0,1308,1309,1,0,0,0,
        1309,1307,1,0,0,0,1309,1310,1,0,0,0,1310,1319,1,0,0,0,1311,1313,
        5,99,0,0,1312,1311,1,0,0,0,1312,1313,1,0,0,0,1313,1314,1,0,0,0,1314,
        1316,5,82,0,0,1315,1317,5,99,0,0,1316,1315,1,0,0,0,1316,1317,1,0,
        0,0,1317,1318,1,0,0,0,1318,1320,3,72,36,0,1319,1312,1,0,0,0,1319,
        1320,1,0,0,0,1320,1322,1,0,0,0,1321,1323,5,99,0,0,1322,1321,1,0,
        0,0,1322,1323,1,0,0,0,1323,1324,1,0,0,0,1324,1325,5,83,0,0,1325,
        153,1,0,0,0,1326,1329,5,27,0,0,1327,1330,3,174,87,0,1328,1330,3,
        160,80,0,1329,1327,1,0,0,0,1329,1328,1,0,0,0,1330,155,1,0,0,0,1331,
        1339,3,158,79,0,1332,1339,3,160,80,0,1333,1339,5,73,0,0,1334,1339,
        3,162,81,0,1335,1339,3,164,82,0,1336,1339,3,166,83,0,1337,1339,3,
        168,84,0,1338,1331,1,0,0,0,1338,1332,1,0,0,0,1338,1333,1,0,0,0,1338,
        1334,1,0,0,0,1338,1335,1,0,0,0,1338,1336,1,0,0,0,1338,1337,1,0,0,
        0,1339,157,1,0,0,0,1340,1341,7,7,0,0,1341,159,1,0,0,0,1342,1343,
        5,93,0,0,1343,161,1,0,0,0,1344,1345,5,91,0,0,1345,163,1,0,0,0,1346,
        1347,5,90,0,0,1347,165,1,0,0,0,1348,1350,5,16,0,0,1349,1351,5,99,
        0,0,1350,1349,1,0,0,0,1350,1351,1,0,0,0,1351,1353,1,0,0,0,1352,1354,
        3,150,75,0,1353,1352,1,0,0,0,1353,1354,1,0,0,0,1354,1356,1,0,0,0,
        1355,1357,5,99,0,0,1356,1355,1,0,0,0,1356,1357,1,0,0,0,1357,1358,
        1,0,0,0,1358,1359,5,17,0,0,1359,167,1,0,0,0,1360,1362,5,14,0,0,1361,
        1363,5,99,0,0,1362,1361,1,0,0,0,1362,1363,1,0,0,0,1363,1378,1,0,
        0,0,1364,1375,3,170,85,0,1365,1367,5,99,0,0,1366,1365,1,0,0,0,1366,
        1367,1,0,0,0,1367,1368,1,0,0,0,1368,1370,5,11,0,0,1369,1371,5,99,
        0,0,1370,1369,1,0,0,0,1370,1371,1,0,0,0,1371,1372,1,0,0,0,1372,1374,
        3,170,85,0,1373,1366,1,0,0,0,1374,1377,1,0,0,0,1375,1373,1,0,0,0,
        1375,1376,1,0,0,0,1376,1379,1,0,0,0,1377,1375,1,0,0,0,1378,1364,
        1,0,0,0,1378,1379,1,0,0,0,1379,1381,1,0,0,0,1380,1382,5,99,0,0,1381,
        1380,1,0,0,0,1381,1382,1,0,0,0,1382,1383,1,0,0,0,1383,1384,5,15,
        0,0,1384,169,1,0,0,0,1385,1387,3,172,86,0,1386,1388,5,99,0,0,1387,
        1386,1,0,0,0,1387,1388,1,0,0,0,1388,1389,1,0,0,0,1389,1391,5,25,
        0,0,1390,1392,5,99,0,0,1391,1390,1,0,0,0,1391,1392,1,0,0,0,1392,
        1393,1,0,0,0,1393,1394,3,72,36,0,1394,171,1,0,0,0,1395,1398,3,174,
        87,0,1396,1398,3,176,88,0,1397,1395,1,0,0,0,1397,1396,1,0,0,0,1398,
        173,1,0,0,0,1399,1400,7,8,0,0,1400,175,1,0,0,0,1401,1402,7,9,0,0,
        1402,177,1,0,0,0,290,179,183,186,189,195,201,206,210,214,217,220,
        224,228,230,234,240,244,247,251,257,262,265,268,272,275,278,281,
        284,287,291,294,298,303,308,312,315,319,322,326,330,334,338,343,
        348,352,358,362,365,368,370,374,378,383,387,392,398,402,408,412,
        416,423,430,434,438,444,448,452,457,462,467,471,475,479,483,486,
        490,493,496,502,506,511,515,518,522,526,528,534,538,543,548,552,
        558,562,566,571,576,580,586,590,596,600,604,609,613,619,622,626,
        632,636,641,646,650,655,660,664,669,674,678,683,688,692,699,703,
        709,716,720,725,730,734,739,744,748,753,757,760,766,771,775,779,
        783,788,791,794,798,801,804,807,810,814,820,825,829,832,836,839,
        842,848,851,855,859,864,869,873,875,881,886,891,895,900,904,910,
        914,917,920,923,926,929,932,948,955,959,962,965,969,972,976,979,
        982,986,989,991,995,998,1001,1004,1007,1010,1013,1016,1019,1025,
        1028,1031,1035,1038,1040,1044,1048,1052,1055,1058,1063,1068,1071,
        1074,1080,1084,1088,1091,1097,1101,1106,1111,1115,1119,1121,1125,
        1131,1135,1139,1141,1144,1147,1151,1155,1159,1165,1169,1173,1179,
        1183,1187,1189,1193,1196,1199,1203,1207,1213,1218,1222,1226,1230,
        1233,1236,1242,1246,1250,1253,1257,1261,1265,1271,1275,1280,1285,
        1288,1291,1295,1299,1303,1309,1312,1316,1319,1322,1329,1338,1350,
        1353,1356,1362,1366,1370,1375,1378,1381,1387,1391,1397
    ];

    private static __ATN: antlr.ATN;
    public static get _ATN(): antlr.ATN {
        if (!CypherParser.__ATN) {
            CypherParser.__ATN = new antlr.ATNDeserializer().deserialize(CypherParser._serializedATN);
        }

        return CypherParser.__ATN;
    }


    private static readonly vocabulary = new antlr.Vocabulary(CypherParser.literalNames, CypherParser.symbolicNames, []);

    public override get vocabulary(): antlr.Vocabulary {
        return CypherParser.vocabulary;
    }

    private static readonly decisionsToDFA = CypherParser._ATN.decisionToState.map( (ds: antlr.DecisionState, index: number) => new antlr.DFA(ds, index) );
}

export class ScriptContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public query(): QueryContext {
        return this.getRuleContext(0, QueryContext)!;
    }
    public EOF(): antlr.TerminalNode {
        return this.getToken(CypherParser.EOF, 0)!;
    }
    public SP(): antlr.TerminalNode[];
    public SP(i: number): antlr.TerminalNode | null;
    public SP(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(CypherParser.SP);
    	} else {
    		return this.getToken(CypherParser.SP, i);
    	}
    }
    public SEMI(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.SEMI, 0);
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_script;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterScript) {
             listener.enterScript(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitScript) {
             listener.exitScript(this);
        }
    }
}


export class QueryContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public regularQuery(): RegularQueryContext | null {
        return this.getRuleContext(0, RegularQueryContext);
    }
    public standaloneCall(): StandaloneCallContext | null {
        return this.getRuleContext(0, StandaloneCallContext);
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_query;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterQuery) {
             listener.enterQuery(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitQuery) {
             listener.exitQuery(this);
        }
    }
}


export class RegularQueryContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public singleQuery(): SingleQueryContext {
        return this.getRuleContext(0, SingleQueryContext)!;
    }
    public unionSt(): UnionStContext[];
    public unionSt(i: number): UnionStContext | null;
    public unionSt(i?: number): UnionStContext[] | UnionStContext | null {
        if (i === undefined) {
            return this.getRuleContexts(UnionStContext);
        }

        return this.getRuleContext(i, UnionStContext);
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_regularQuery;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterRegularQuery) {
             listener.enterRegularQuery(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitRegularQuery) {
             listener.exitRegularQuery(this);
        }
    }
}


export class SingleQueryContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public singlePartQ(): SinglePartQContext | null {
        return this.getRuleContext(0, SinglePartQContext);
    }
    public multiPartQ(): MultiPartQContext | null {
        return this.getRuleContext(0, MultiPartQContext);
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_singleQuery;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterSingleQuery) {
             listener.enterSingleQuery(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitSingleQuery) {
             listener.exitSingleQuery(this);
        }
    }
}


export class StandaloneCallContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public CALL(): antlr.TerminalNode {
        return this.getToken(CypherParser.CALL, 0)!;
    }
    public invocationName(): InvocationNameContext {
        return this.getRuleContext(0, InvocationNameContext)!;
    }
    public SP(): antlr.TerminalNode[];
    public SP(i: number): antlr.TerminalNode | null;
    public SP(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(CypherParser.SP);
    	} else {
    		return this.getToken(CypherParser.SP, i);
    	}
    }
    public parenExpressionChain(): ParenExpressionChainContext | null {
        return this.getRuleContext(0, ParenExpressionChainContext);
    }
    public YIELD(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.YIELD, 0);
    }
    public MULT(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.MULT, 0);
    }
    public yieldItems(): YieldItemsContext | null {
        return this.getRuleContext(0, YieldItemsContext);
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_standaloneCall;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterStandaloneCall) {
             listener.enterStandaloneCall(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitStandaloneCall) {
             listener.exitStandaloneCall(this);
        }
    }
}


export class ReturnStContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public RETURN(): antlr.TerminalNode {
        return this.getToken(CypherParser.RETURN, 0)!;
    }
    public projectionBody(): ProjectionBodyContext {
        return this.getRuleContext(0, ProjectionBodyContext)!;
    }
    public SP(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.SP, 0);
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_returnSt;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterReturnSt) {
             listener.enterReturnSt(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitReturnSt) {
             listener.exitReturnSt(this);
        }
    }
}


export class WithStContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public WITH(): antlr.TerminalNode {
        return this.getToken(CypherParser.WITH, 0)!;
    }
    public projectionBody(): ProjectionBodyContext {
        return this.getRuleContext(0, ProjectionBodyContext)!;
    }
    public SP(): antlr.TerminalNode[];
    public SP(i: number): antlr.TerminalNode | null;
    public SP(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(CypherParser.SP);
    	} else {
    		return this.getToken(CypherParser.SP, i);
    	}
    }
    public where(): WhereContext | null {
        return this.getRuleContext(0, WhereContext);
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_withSt;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterWithSt) {
             listener.enterWithSt(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitWithSt) {
             listener.exitWithSt(this);
        }
    }
}


export class SkipStContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public SKIP_W(): antlr.TerminalNode {
        return this.getToken(CypherParser.SKIP_W, 0)!;
    }
    public expression(): ExpressionContext {
        return this.getRuleContext(0, ExpressionContext)!;
    }
    public SP(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.SP, 0);
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_skipSt;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterSkipSt) {
             listener.enterSkipSt(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitSkipSt) {
             listener.exitSkipSt(this);
        }
    }
}


export class LimitStContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public LIMIT(): antlr.TerminalNode {
        return this.getToken(CypherParser.LIMIT, 0)!;
    }
    public expression(): ExpressionContext {
        return this.getRuleContext(0, ExpressionContext)!;
    }
    public SP(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.SP, 0);
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_limitSt;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterLimitSt) {
             listener.enterLimitSt(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitLimitSt) {
             listener.exitLimitSt(this);
        }
    }
}


export class ProjectionBodyContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public projectionItems(): ProjectionItemsContext {
        return this.getRuleContext(0, ProjectionItemsContext)!;
    }
    public DISTINCT(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.DISTINCT, 0);
    }
    public SP(): antlr.TerminalNode[];
    public SP(i: number): antlr.TerminalNode | null;
    public SP(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(CypherParser.SP);
    	} else {
    		return this.getToken(CypherParser.SP, i);
    	}
    }
    public orderSt(): OrderStContext | null {
        return this.getRuleContext(0, OrderStContext);
    }
    public skipSt(): SkipStContext | null {
        return this.getRuleContext(0, SkipStContext);
    }
    public limitSt(): LimitStContext | null {
        return this.getRuleContext(0, LimitStContext);
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_projectionBody;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterProjectionBody) {
             listener.enterProjectionBody(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitProjectionBody) {
             listener.exitProjectionBody(this);
        }
    }
}


export class ProjectionItemsContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public MULT(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.MULT, 0);
    }
    public projectionItem(): ProjectionItemContext[];
    public projectionItem(i: number): ProjectionItemContext | null;
    public projectionItem(i?: number): ProjectionItemContext[] | ProjectionItemContext | null {
        if (i === undefined) {
            return this.getRuleContexts(ProjectionItemContext);
        }

        return this.getRuleContext(i, ProjectionItemContext);
    }
    public COMMA(): antlr.TerminalNode[];
    public COMMA(i: number): antlr.TerminalNode | null;
    public COMMA(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(CypherParser.COMMA);
    	} else {
    		return this.getToken(CypherParser.COMMA, i);
    	}
    }
    public SP(): antlr.TerminalNode[];
    public SP(i: number): antlr.TerminalNode | null;
    public SP(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(CypherParser.SP);
    	} else {
    		return this.getToken(CypherParser.SP, i);
    	}
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_projectionItems;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterProjectionItems) {
             listener.enterProjectionItems(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitProjectionItems) {
             listener.exitProjectionItems(this);
        }
    }
}


export class ProjectionItemContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public expression(): ExpressionContext {
        return this.getRuleContext(0, ExpressionContext)!;
    }
    public AS(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.AS, 0);
    }
    public symbol(): SymbolContext | null {
        return this.getRuleContext(0, SymbolContext);
    }
    public SP(): antlr.TerminalNode[];
    public SP(i: number): antlr.TerminalNode | null;
    public SP(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(CypherParser.SP);
    	} else {
    		return this.getToken(CypherParser.SP, i);
    	}
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_projectionItem;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterProjectionItem) {
             listener.enterProjectionItem(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitProjectionItem) {
             listener.exitProjectionItem(this);
        }
    }
}


export class OrderItemContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public expression(): ExpressionContext {
        return this.getRuleContext(0, ExpressionContext)!;
    }
    public ASCENDING(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.ASCENDING, 0);
    }
    public ASC(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.ASC, 0);
    }
    public DESCENDING(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.DESCENDING, 0);
    }
    public DESC(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.DESC, 0);
    }
    public SP(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.SP, 0);
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_orderItem;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterOrderItem) {
             listener.enterOrderItem(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitOrderItem) {
             listener.exitOrderItem(this);
        }
    }
}


export class OrderStContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public ORDER(): antlr.TerminalNode {
        return this.getToken(CypherParser.ORDER, 0)!;
    }
    public BY(): antlr.TerminalNode {
        return this.getToken(CypherParser.BY, 0)!;
    }
    public orderItem(): OrderItemContext[];
    public orderItem(i: number): OrderItemContext | null;
    public orderItem(i?: number): OrderItemContext[] | OrderItemContext | null {
        if (i === undefined) {
            return this.getRuleContexts(OrderItemContext);
        }

        return this.getRuleContext(i, OrderItemContext);
    }
    public SP(): antlr.TerminalNode[];
    public SP(i: number): antlr.TerminalNode | null;
    public SP(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(CypherParser.SP);
    	} else {
    		return this.getToken(CypherParser.SP, i);
    	}
    }
    public COMMA(): antlr.TerminalNode[];
    public COMMA(i: number): antlr.TerminalNode | null;
    public COMMA(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(CypherParser.COMMA);
    	} else {
    		return this.getToken(CypherParser.COMMA, i);
    	}
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_orderSt;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterOrderSt) {
             listener.enterOrderSt(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitOrderSt) {
             listener.exitOrderSt(this);
        }
    }
}


export class SinglePartQContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public returnSt(): ReturnStContext | null {
        return this.getRuleContext(0, ReturnStContext);
    }
    public readingStatement(): ReadingStatementContext[];
    public readingStatement(i: number): ReadingStatementContext | null;
    public readingStatement(i?: number): ReadingStatementContext[] | ReadingStatementContext | null {
        if (i === undefined) {
            return this.getRuleContexts(ReadingStatementContext);
        }

        return this.getRuleContext(i, ReadingStatementContext);
    }
    public updatingStatement(): UpdatingStatementContext[];
    public updatingStatement(i: number): UpdatingStatementContext | null;
    public updatingStatement(i?: number): UpdatingStatementContext[] | UpdatingStatementContext | null {
        if (i === undefined) {
            return this.getRuleContexts(UpdatingStatementContext);
        }

        return this.getRuleContext(i, UpdatingStatementContext);
    }
    public SP(): antlr.TerminalNode[];
    public SP(i: number): antlr.TerminalNode | null;
    public SP(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(CypherParser.SP);
    	} else {
    		return this.getToken(CypherParser.SP, i);
    	}
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_singlePartQ;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterSinglePartQ) {
             listener.enterSinglePartQ(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitSinglePartQ) {
             listener.exitSinglePartQ(this);
        }
    }
}


export class MultiPartQContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public withSt(): WithStContext {
        return this.getRuleContext(0, WithStContext)!;
    }
    public singlePartQ(): SinglePartQContext {
        return this.getRuleContext(0, SinglePartQContext)!;
    }
    public readingStatement(): ReadingStatementContext[];
    public readingStatement(i: number): ReadingStatementContext | null;
    public readingStatement(i?: number): ReadingStatementContext[] | ReadingStatementContext | null {
        if (i === undefined) {
            return this.getRuleContexts(ReadingStatementContext);
        }

        return this.getRuleContext(i, ReadingStatementContext);
    }
    public updatingStatement(): UpdatingStatementContext[];
    public updatingStatement(i: number): UpdatingStatementContext | null;
    public updatingStatement(i?: number): UpdatingStatementContext[] | UpdatingStatementContext | null {
        if (i === undefined) {
            return this.getRuleContexts(UpdatingStatementContext);
        }

        return this.getRuleContext(i, UpdatingStatementContext);
    }
    public SP(): antlr.TerminalNode[];
    public SP(i: number): antlr.TerminalNode | null;
    public SP(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(CypherParser.SP);
    	} else {
    		return this.getToken(CypherParser.SP, i);
    	}
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_multiPartQ;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterMultiPartQ) {
             listener.enterMultiPartQ(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitMultiPartQ) {
             listener.exitMultiPartQ(this);
        }
    }
}


export class MatchStContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public MATCH(): antlr.TerminalNode {
        return this.getToken(CypherParser.MATCH, 0)!;
    }
    public patternWhere(): PatternWhereContext {
        return this.getRuleContext(0, PatternWhereContext)!;
    }
    public OPTIONAL(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.OPTIONAL, 0);
    }
    public SP(): antlr.TerminalNode[];
    public SP(i: number): antlr.TerminalNode | null;
    public SP(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(CypherParser.SP);
    	} else {
    		return this.getToken(CypherParser.SP, i);
    	}
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_matchSt;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterMatchSt) {
             listener.enterMatchSt(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitMatchSt) {
             listener.exitMatchSt(this);
        }
    }
}


export class UnwindStContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public UNWIND(): antlr.TerminalNode {
        return this.getToken(CypherParser.UNWIND, 0)!;
    }
    public expression(): ExpressionContext {
        return this.getRuleContext(0, ExpressionContext)!;
    }
    public AS(): antlr.TerminalNode {
        return this.getToken(CypherParser.AS, 0)!;
    }
    public symbol(): SymbolContext {
        return this.getRuleContext(0, SymbolContext)!;
    }
    public SP(): antlr.TerminalNode[];
    public SP(i: number): antlr.TerminalNode | null;
    public SP(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(CypherParser.SP);
    	} else {
    		return this.getToken(CypherParser.SP, i);
    	}
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_unwindSt;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterUnwindSt) {
             listener.enterUnwindSt(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitUnwindSt) {
             listener.exitUnwindSt(this);
        }
    }
}


export class ReadingStatementContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public matchSt(): MatchStContext | null {
        return this.getRuleContext(0, MatchStContext);
    }
    public unwindSt(): UnwindStContext | null {
        return this.getRuleContext(0, UnwindStContext);
    }
    public queryCallSt(): QueryCallStContext | null {
        return this.getRuleContext(0, QueryCallStContext);
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_readingStatement;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterReadingStatement) {
             listener.enterReadingStatement(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitReadingStatement) {
             listener.exitReadingStatement(this);
        }
    }
}


export class UpdatingStatementContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public createSt(): CreateStContext | null {
        return this.getRuleContext(0, CreateStContext);
    }
    public mergeSt(): MergeStContext | null {
        return this.getRuleContext(0, MergeStContext);
    }
    public deleteSt(): DeleteStContext | null {
        return this.getRuleContext(0, DeleteStContext);
    }
    public setSt(): SetStContext | null {
        return this.getRuleContext(0, SetStContext);
    }
    public removeSt(): RemoveStContext | null {
        return this.getRuleContext(0, RemoveStContext);
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_updatingStatement;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterUpdatingStatement) {
             listener.enterUpdatingStatement(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitUpdatingStatement) {
             listener.exitUpdatingStatement(this);
        }
    }
}


export class DeleteStContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public DELETE(): antlr.TerminalNode {
        return this.getToken(CypherParser.DELETE, 0)!;
    }
    public expressionChain(): ExpressionChainContext {
        return this.getRuleContext(0, ExpressionChainContext)!;
    }
    public DETACH(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.DETACH, 0);
    }
    public SP(): antlr.TerminalNode[];
    public SP(i: number): antlr.TerminalNode | null;
    public SP(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(CypherParser.SP);
    	} else {
    		return this.getToken(CypherParser.SP, i);
    	}
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_deleteSt;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterDeleteSt) {
             listener.enterDeleteSt(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitDeleteSt) {
             listener.exitDeleteSt(this);
        }
    }
}


export class RemoveStContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public REMOVE(): antlr.TerminalNode {
        return this.getToken(CypherParser.REMOVE, 0)!;
    }
    public removeItem(): RemoveItemContext[];
    public removeItem(i: number): RemoveItemContext | null;
    public removeItem(i?: number): RemoveItemContext[] | RemoveItemContext | null {
        if (i === undefined) {
            return this.getRuleContexts(RemoveItemContext);
        }

        return this.getRuleContext(i, RemoveItemContext);
    }
    public SP(): antlr.TerminalNode[];
    public SP(i: number): antlr.TerminalNode | null;
    public SP(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(CypherParser.SP);
    	} else {
    		return this.getToken(CypherParser.SP, i);
    	}
    }
    public COMMA(): antlr.TerminalNode[];
    public COMMA(i: number): antlr.TerminalNode | null;
    public COMMA(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(CypherParser.COMMA);
    	} else {
    		return this.getToken(CypherParser.COMMA, i);
    	}
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_removeSt;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterRemoveSt) {
             listener.enterRemoveSt(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitRemoveSt) {
             listener.exitRemoveSt(this);
        }
    }
}


export class RemoveItemContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public symbol(): SymbolContext | null {
        return this.getRuleContext(0, SymbolContext);
    }
    public nodeLabels(): NodeLabelsContext | null {
        return this.getRuleContext(0, NodeLabelsContext);
    }
    public SP(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.SP, 0);
    }
    public propertyExpression(): PropertyExpressionContext | null {
        return this.getRuleContext(0, PropertyExpressionContext);
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_removeItem;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterRemoveItem) {
             listener.enterRemoveItem(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitRemoveItem) {
             listener.exitRemoveItem(this);
        }
    }
}


export class QueryCallStContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public CALL(): antlr.TerminalNode {
        return this.getToken(CypherParser.CALL, 0)!;
    }
    public invocationName(): InvocationNameContext {
        return this.getRuleContext(0, InvocationNameContext)!;
    }
    public parenExpressionChain(): ParenExpressionChainContext {
        return this.getRuleContext(0, ParenExpressionChainContext)!;
    }
    public SP(): antlr.TerminalNode[];
    public SP(i: number): antlr.TerminalNode | null;
    public SP(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(CypherParser.SP);
    	} else {
    		return this.getToken(CypherParser.SP, i);
    	}
    }
    public YIELD(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.YIELD, 0);
    }
    public yieldItems(): YieldItemsContext | null {
        return this.getRuleContext(0, YieldItemsContext);
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_queryCallSt;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterQueryCallSt) {
             listener.enterQueryCallSt(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitQueryCallSt) {
             listener.exitQueryCallSt(this);
        }
    }
}


export class ParenExpressionChainContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public LPAREN(): antlr.TerminalNode {
        return this.getToken(CypherParser.LPAREN, 0)!;
    }
    public RPAREN(): antlr.TerminalNode {
        return this.getToken(CypherParser.RPAREN, 0)!;
    }
    public SP(): antlr.TerminalNode[];
    public SP(i: number): antlr.TerminalNode | null;
    public SP(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(CypherParser.SP);
    	} else {
    		return this.getToken(CypherParser.SP, i);
    	}
    }
    public expressionChain(): ExpressionChainContext | null {
        return this.getRuleContext(0, ExpressionChainContext);
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_parenExpressionChain;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterParenExpressionChain) {
             listener.enterParenExpressionChain(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitParenExpressionChain) {
             listener.exitParenExpressionChain(this);
        }
    }
}


export class YieldItemsContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public yieldItem(): YieldItemContext[];
    public yieldItem(i: number): YieldItemContext | null;
    public yieldItem(i?: number): YieldItemContext[] | YieldItemContext | null {
        if (i === undefined) {
            return this.getRuleContexts(YieldItemContext);
        }

        return this.getRuleContext(i, YieldItemContext);
    }
    public COMMA(): antlr.TerminalNode[];
    public COMMA(i: number): antlr.TerminalNode | null;
    public COMMA(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(CypherParser.COMMA);
    	} else {
    		return this.getToken(CypherParser.COMMA, i);
    	}
    }
    public where(): WhereContext | null {
        return this.getRuleContext(0, WhereContext);
    }
    public SP(): antlr.TerminalNode[];
    public SP(i: number): antlr.TerminalNode | null;
    public SP(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(CypherParser.SP);
    	} else {
    		return this.getToken(CypherParser.SP, i);
    	}
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_yieldItems;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterYieldItems) {
             listener.enterYieldItems(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitYieldItems) {
             listener.exitYieldItems(this);
        }
    }
}


export class YieldItemContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public symbol_(): SymbolContext[];
    public symbol_(i: number): SymbolContext | null;
    public symbol_(i?: number): SymbolContext[] | SymbolContext | null {
        if (i === undefined) {
            return this.getRuleContexts(SymbolContext);
        }

        return this.getRuleContext(i, SymbolContext);
    }
    public AS(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.AS, 0);
    }
    public SP(): antlr.TerminalNode[];
    public SP(i: number): antlr.TerminalNode | null;
    public SP(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(CypherParser.SP);
    	} else {
    		return this.getToken(CypherParser.SP, i);
    	}
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_yieldItem;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterYieldItem) {
             listener.enterYieldItem(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitYieldItem) {
             listener.exitYieldItem(this);
        }
    }
}


export class MergeStContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public MERGE(): antlr.TerminalNode {
        return this.getToken(CypherParser.MERGE, 0)!;
    }
    public patternPart(): PatternPartContext {
        return this.getRuleContext(0, PatternPartContext)!;
    }
    public SP(): antlr.TerminalNode[];
    public SP(i: number): antlr.TerminalNode | null;
    public SP(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(CypherParser.SP);
    	} else {
    		return this.getToken(CypherParser.SP, i);
    	}
    }
    public mergeAction(): MergeActionContext[];
    public mergeAction(i: number): MergeActionContext | null;
    public mergeAction(i?: number): MergeActionContext[] | MergeActionContext | null {
        if (i === undefined) {
            return this.getRuleContexts(MergeActionContext);
        }

        return this.getRuleContext(i, MergeActionContext);
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_mergeSt;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterMergeSt) {
             listener.enterMergeSt(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitMergeSt) {
             listener.exitMergeSt(this);
        }
    }
}


export class MergeActionContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public ON(): antlr.TerminalNode {
        return this.getToken(CypherParser.ON, 0)!;
    }
    public setSt(): SetStContext {
        return this.getRuleContext(0, SetStContext)!;
    }
    public MATCH(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.MATCH, 0);
    }
    public CREATE(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.CREATE, 0);
    }
    public SP(): antlr.TerminalNode[];
    public SP(i: number): antlr.TerminalNode | null;
    public SP(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(CypherParser.SP);
    	} else {
    		return this.getToken(CypherParser.SP, i);
    	}
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_mergeAction;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterMergeAction) {
             listener.enterMergeAction(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitMergeAction) {
             listener.exitMergeAction(this);
        }
    }
}


export class SetStContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public SET(): antlr.TerminalNode {
        return this.getToken(CypherParser.SET, 0)!;
    }
    public setItem(): SetItemContext[];
    public setItem(i: number): SetItemContext | null;
    public setItem(i?: number): SetItemContext[] | SetItemContext | null {
        if (i === undefined) {
            return this.getRuleContexts(SetItemContext);
        }

        return this.getRuleContext(i, SetItemContext);
    }
    public SP(): antlr.TerminalNode[];
    public SP(i: number): antlr.TerminalNode | null;
    public SP(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(CypherParser.SP);
    	} else {
    		return this.getToken(CypherParser.SP, i);
    	}
    }
    public COMMA(): antlr.TerminalNode[];
    public COMMA(i: number): antlr.TerminalNode | null;
    public COMMA(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(CypherParser.COMMA);
    	} else {
    		return this.getToken(CypherParser.COMMA, i);
    	}
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_setSt;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterSetSt) {
             listener.enterSetSt(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitSetSt) {
             listener.exitSetSt(this);
        }
    }
}


export class SetItemContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public propertyExpression(): PropertyExpressionContext | null {
        return this.getRuleContext(0, PropertyExpressionContext);
    }
    public ASSIGN(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.ASSIGN, 0);
    }
    public expression(): ExpressionContext | null {
        return this.getRuleContext(0, ExpressionContext);
    }
    public SP(): antlr.TerminalNode[];
    public SP(i: number): antlr.TerminalNode | null;
    public SP(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(CypherParser.SP);
    	} else {
    		return this.getToken(CypherParser.SP, i);
    	}
    }
    public symbol(): SymbolContext | null {
        return this.getRuleContext(0, SymbolContext);
    }
    public ADD_ASSIGN(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.ADD_ASSIGN, 0);
    }
    public nodeLabels(): NodeLabelsContext | null {
        return this.getRuleContext(0, NodeLabelsContext);
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_setItem;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterSetItem) {
             listener.enterSetItem(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitSetItem) {
             listener.exitSetItem(this);
        }
    }
}


export class NodeLabelsContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public COLON(): antlr.TerminalNode[];
    public COLON(i: number): antlr.TerminalNode | null;
    public COLON(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(CypherParser.COLON);
    	} else {
    		return this.getToken(CypherParser.COLON, i);
    	}
    }
    public name(): NameContext[];
    public name(i: number): NameContext | null;
    public name(i?: number): NameContext[] | NameContext | null {
        if (i === undefined) {
            return this.getRuleContexts(NameContext);
        }

        return this.getRuleContext(i, NameContext);
    }
    public SP(): antlr.TerminalNode[];
    public SP(i: number): antlr.TerminalNode | null;
    public SP(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(CypherParser.SP);
    	} else {
    		return this.getToken(CypherParser.SP, i);
    	}
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_nodeLabels;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterNodeLabels) {
             listener.enterNodeLabels(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitNodeLabels) {
             listener.exitNodeLabels(this);
        }
    }
}


export class CreateStContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public CREATE(): antlr.TerminalNode {
        return this.getToken(CypherParser.CREATE, 0)!;
    }
    public pattern(): PatternContext {
        return this.getRuleContext(0, PatternContext)!;
    }
    public SP(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.SP, 0);
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_createSt;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterCreateSt) {
             listener.enterCreateSt(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitCreateSt) {
             listener.exitCreateSt(this);
        }
    }
}


export class PatternWhereContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public pattern(): PatternContext {
        return this.getRuleContext(0, PatternContext)!;
    }
    public where(): WhereContext | null {
        return this.getRuleContext(0, WhereContext);
    }
    public SP(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.SP, 0);
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_patternWhere;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterPatternWhere) {
             listener.enterPatternWhere(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitPatternWhere) {
             listener.exitPatternWhere(this);
        }
    }
}


export class WhereContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public WHERE(): antlr.TerminalNode {
        return this.getToken(CypherParser.WHERE, 0)!;
    }
    public expression(): ExpressionContext {
        return this.getRuleContext(0, ExpressionContext)!;
    }
    public SP(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.SP, 0);
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_where;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterWhere) {
             listener.enterWhere(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitWhere) {
             listener.exitWhere(this);
        }
    }
}


export class PatternContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public patternPart(): PatternPartContext[];
    public patternPart(i: number): PatternPartContext | null;
    public patternPart(i?: number): PatternPartContext[] | PatternPartContext | null {
        if (i === undefined) {
            return this.getRuleContexts(PatternPartContext);
        }

        return this.getRuleContext(i, PatternPartContext);
    }
    public COMMA(): antlr.TerminalNode[];
    public COMMA(i: number): antlr.TerminalNode | null;
    public COMMA(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(CypherParser.COMMA);
    	} else {
    		return this.getToken(CypherParser.COMMA, i);
    	}
    }
    public SP(): antlr.TerminalNode[];
    public SP(i: number): antlr.TerminalNode | null;
    public SP(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(CypherParser.SP);
    	} else {
    		return this.getToken(CypherParser.SP, i);
    	}
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_pattern;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterPattern) {
             listener.enterPattern(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitPattern) {
             listener.exitPattern(this);
        }
    }
}


export class ExpressionContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public xorExpression(): XorExpressionContext[];
    public xorExpression(i: number): XorExpressionContext | null;
    public xorExpression(i?: number): XorExpressionContext[] | XorExpressionContext | null {
        if (i === undefined) {
            return this.getRuleContexts(XorExpressionContext);
        }

        return this.getRuleContext(i, XorExpressionContext);
    }
    public OR(): antlr.TerminalNode[];
    public OR(i: number): antlr.TerminalNode | null;
    public OR(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(CypherParser.OR);
    	} else {
    		return this.getToken(CypherParser.OR, i);
    	}
    }
    public SP(): antlr.TerminalNode[];
    public SP(i: number): antlr.TerminalNode | null;
    public SP(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(CypherParser.SP);
    	} else {
    		return this.getToken(CypherParser.SP, i);
    	}
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_expression;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterExpression) {
             listener.enterExpression(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitExpression) {
             listener.exitExpression(this);
        }
    }
}


export class XorExpressionContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public andExpression(): AndExpressionContext[];
    public andExpression(i: number): AndExpressionContext | null;
    public andExpression(i?: number): AndExpressionContext[] | AndExpressionContext | null {
        if (i === undefined) {
            return this.getRuleContexts(AndExpressionContext);
        }

        return this.getRuleContext(i, AndExpressionContext);
    }
    public XOR(): antlr.TerminalNode[];
    public XOR(i: number): antlr.TerminalNode | null;
    public XOR(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(CypherParser.XOR);
    	} else {
    		return this.getToken(CypherParser.XOR, i);
    	}
    }
    public SP(): antlr.TerminalNode[];
    public SP(i: number): antlr.TerminalNode | null;
    public SP(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(CypherParser.SP);
    	} else {
    		return this.getToken(CypherParser.SP, i);
    	}
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_xorExpression;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterXorExpression) {
             listener.enterXorExpression(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitXorExpression) {
             listener.exitXorExpression(this);
        }
    }
}


export class AndExpressionContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public notExpression(): NotExpressionContext[];
    public notExpression(i: number): NotExpressionContext | null;
    public notExpression(i?: number): NotExpressionContext[] | NotExpressionContext | null {
        if (i === undefined) {
            return this.getRuleContexts(NotExpressionContext);
        }

        return this.getRuleContext(i, NotExpressionContext);
    }
    public AND(): antlr.TerminalNode[];
    public AND(i: number): antlr.TerminalNode | null;
    public AND(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(CypherParser.AND);
    	} else {
    		return this.getToken(CypherParser.AND, i);
    	}
    }
    public SP(): antlr.TerminalNode[];
    public SP(i: number): antlr.TerminalNode | null;
    public SP(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(CypherParser.SP);
    	} else {
    		return this.getToken(CypherParser.SP, i);
    	}
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_andExpression;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterAndExpression) {
             listener.enterAndExpression(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitAndExpression) {
             listener.exitAndExpression(this);
        }
    }
}


export class NotExpressionContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public comparisonExpression(): ComparisonExpressionContext {
        return this.getRuleContext(0, ComparisonExpressionContext)!;
    }
    public NOT(): antlr.TerminalNode[];
    public NOT(i: number): antlr.TerminalNode | null;
    public NOT(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(CypherParser.NOT);
    	} else {
    		return this.getToken(CypherParser.NOT, i);
    	}
    }
    public SP(): antlr.TerminalNode[];
    public SP(i: number): antlr.TerminalNode | null;
    public SP(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(CypherParser.SP);
    	} else {
    		return this.getToken(CypherParser.SP, i);
    	}
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_notExpression;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterNotExpression) {
             listener.enterNotExpression(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitNotExpression) {
             listener.exitNotExpression(this);
        }
    }
}


export class ComparisonExpressionContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public addSubExpression(): AddSubExpressionContext[];
    public addSubExpression(i: number): AddSubExpressionContext | null;
    public addSubExpression(i?: number): AddSubExpressionContext[] | AddSubExpressionContext | null {
        if (i === undefined) {
            return this.getRuleContexts(AddSubExpressionContext);
        }

        return this.getRuleContext(i, AddSubExpressionContext);
    }
    public comparisonSigns(): ComparisonSignsContext[];
    public comparisonSigns(i: number): ComparisonSignsContext | null;
    public comparisonSigns(i?: number): ComparisonSignsContext[] | ComparisonSignsContext | null {
        if (i === undefined) {
            return this.getRuleContexts(ComparisonSignsContext);
        }

        return this.getRuleContext(i, ComparisonSignsContext);
    }
    public SP(): antlr.TerminalNode[];
    public SP(i: number): antlr.TerminalNode | null;
    public SP(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(CypherParser.SP);
    	} else {
    		return this.getToken(CypherParser.SP, i);
    	}
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_comparisonExpression;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterComparisonExpression) {
             listener.enterComparisonExpression(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitComparisonExpression) {
             listener.exitComparisonExpression(this);
        }
    }
}


export class ComparisonSignsContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public ASSIGN(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.ASSIGN, 0);
    }
    public LE(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.LE, 0);
    }
    public GE(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.GE, 0);
    }
    public GT(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.GT, 0);
    }
    public LT(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.LT, 0);
    }
    public NOT_EQUAL(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.NOT_EQUAL, 0);
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_comparisonSigns;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterComparisonSigns) {
             listener.enterComparisonSigns(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitComparisonSigns) {
             listener.exitComparisonSigns(this);
        }
    }
}


export class AddSubExpressionContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public multDivExpression(): MultDivExpressionContext[];
    public multDivExpression(i: number): MultDivExpressionContext | null;
    public multDivExpression(i?: number): MultDivExpressionContext[] | MultDivExpressionContext | null {
        if (i === undefined) {
            return this.getRuleContexts(MultDivExpressionContext);
        }

        return this.getRuleContext(i, MultDivExpressionContext);
    }
    public PLUS(): antlr.TerminalNode[];
    public PLUS(i: number): antlr.TerminalNode | null;
    public PLUS(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(CypherParser.PLUS);
    	} else {
    		return this.getToken(CypherParser.PLUS, i);
    	}
    }
    public SUB(): antlr.TerminalNode[];
    public SUB(i: number): antlr.TerminalNode | null;
    public SUB(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(CypherParser.SUB);
    	} else {
    		return this.getToken(CypherParser.SUB, i);
    	}
    }
    public SP(): antlr.TerminalNode[];
    public SP(i: number): antlr.TerminalNode | null;
    public SP(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(CypherParser.SP);
    	} else {
    		return this.getToken(CypherParser.SP, i);
    	}
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_addSubExpression;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterAddSubExpression) {
             listener.enterAddSubExpression(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitAddSubExpression) {
             listener.exitAddSubExpression(this);
        }
    }
}


export class MultDivExpressionContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public powerExpression(): PowerExpressionContext[];
    public powerExpression(i: number): PowerExpressionContext | null;
    public powerExpression(i?: number): PowerExpressionContext[] | PowerExpressionContext | null {
        if (i === undefined) {
            return this.getRuleContexts(PowerExpressionContext);
        }

        return this.getRuleContext(i, PowerExpressionContext);
    }
    public MULT(): antlr.TerminalNode[];
    public MULT(i: number): antlr.TerminalNode | null;
    public MULT(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(CypherParser.MULT);
    	} else {
    		return this.getToken(CypherParser.MULT, i);
    	}
    }
    public DIV(): antlr.TerminalNode[];
    public DIV(i: number): antlr.TerminalNode | null;
    public DIV(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(CypherParser.DIV);
    	} else {
    		return this.getToken(CypherParser.DIV, i);
    	}
    }
    public MOD(): antlr.TerminalNode[];
    public MOD(i: number): antlr.TerminalNode | null;
    public MOD(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(CypherParser.MOD);
    	} else {
    		return this.getToken(CypherParser.MOD, i);
    	}
    }
    public SP(): antlr.TerminalNode[];
    public SP(i: number): antlr.TerminalNode | null;
    public SP(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(CypherParser.SP);
    	} else {
    		return this.getToken(CypherParser.SP, i);
    	}
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_multDivExpression;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterMultDivExpression) {
             listener.enterMultDivExpression(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitMultDivExpression) {
             listener.exitMultDivExpression(this);
        }
    }
}


export class PowerExpressionContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public unaryAddSubExpression(): UnaryAddSubExpressionContext[];
    public unaryAddSubExpression(i: number): UnaryAddSubExpressionContext | null;
    public unaryAddSubExpression(i?: number): UnaryAddSubExpressionContext[] | UnaryAddSubExpressionContext | null {
        if (i === undefined) {
            return this.getRuleContexts(UnaryAddSubExpressionContext);
        }

        return this.getRuleContext(i, UnaryAddSubExpressionContext);
    }
    public CARET(): antlr.TerminalNode[];
    public CARET(i: number): antlr.TerminalNode | null;
    public CARET(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(CypherParser.CARET);
    	} else {
    		return this.getToken(CypherParser.CARET, i);
    	}
    }
    public SP(): antlr.TerminalNode[];
    public SP(i: number): antlr.TerminalNode | null;
    public SP(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(CypherParser.SP);
    	} else {
    		return this.getToken(CypherParser.SP, i);
    	}
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_powerExpression;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterPowerExpression) {
             listener.enterPowerExpression(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitPowerExpression) {
             listener.exitPowerExpression(this);
        }
    }
}


export class UnaryAddSubExpressionContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public atomicExpression(): AtomicExpressionContext {
        return this.getRuleContext(0, AtomicExpressionContext)!;
    }
    public SP(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.SP, 0);
    }
    public PLUS(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.PLUS, 0);
    }
    public SUB(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.SUB, 0);
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_unaryAddSubExpression;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterUnaryAddSubExpression) {
             listener.enterUnaryAddSubExpression(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitUnaryAddSubExpression) {
             listener.exitUnaryAddSubExpression(this);
        }
    }
}


export class AtomicExpressionContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public propertyOrLabelExpression(): PropertyOrLabelExpressionContext {
        return this.getRuleContext(0, PropertyOrLabelExpressionContext)!;
    }
    public stringExpression(): StringExpressionContext[];
    public stringExpression(i: number): StringExpressionContext | null;
    public stringExpression(i?: number): StringExpressionContext[] | StringExpressionContext | null {
        if (i === undefined) {
            return this.getRuleContexts(StringExpressionContext);
        }

        return this.getRuleContext(i, StringExpressionContext);
    }
    public listExpression(): ListExpressionContext[];
    public listExpression(i: number): ListExpressionContext | null;
    public listExpression(i?: number): ListExpressionContext[] | ListExpressionContext | null {
        if (i === undefined) {
            return this.getRuleContexts(ListExpressionContext);
        }

        return this.getRuleContext(i, ListExpressionContext);
    }
    public nullExpression(): NullExpressionContext[];
    public nullExpression(i: number): NullExpressionContext | null;
    public nullExpression(i?: number): NullExpressionContext[] | NullExpressionContext | null {
        if (i === undefined) {
            return this.getRuleContexts(NullExpressionContext);
        }

        return this.getRuleContext(i, NullExpressionContext);
    }
    public SP(): antlr.TerminalNode[];
    public SP(i: number): antlr.TerminalNode | null;
    public SP(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(CypherParser.SP);
    	} else {
    		return this.getToken(CypherParser.SP, i);
    	}
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_atomicExpression;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterAtomicExpression) {
             listener.enterAtomicExpression(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitAtomicExpression) {
             listener.exitAtomicExpression(this);
        }
    }
}


export class ListExpressionContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public IN(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.IN, 0);
    }
    public propertyOrLabelExpression(): PropertyOrLabelExpressionContext | null {
        return this.getRuleContext(0, PropertyOrLabelExpressionContext);
    }
    public SP(): antlr.TerminalNode[];
    public SP(i: number): antlr.TerminalNode | null;
    public SP(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(CypherParser.SP);
    	} else {
    		return this.getToken(CypherParser.SP, i);
    	}
    }
    public LBRACK(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.LBRACK, 0);
    }
    public RBRACK(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.RBRACK, 0);
    }
    public RANGE(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.RANGE, 0);
    }
    public expression(): ExpressionContext[];
    public expression(i: number): ExpressionContext | null;
    public expression(i?: number): ExpressionContext[] | ExpressionContext | null {
        if (i === undefined) {
            return this.getRuleContexts(ExpressionContext);
        }

        return this.getRuleContext(i, ExpressionContext);
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_listExpression;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterListExpression) {
             listener.enterListExpression(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitListExpression) {
             listener.exitListExpression(this);
        }
    }
}


export class StringExpressionContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public stringExpPrefix(): StringExpPrefixContext {
        return this.getRuleContext(0, StringExpPrefixContext)!;
    }
    public propertyOrLabelExpression(): PropertyOrLabelExpressionContext {
        return this.getRuleContext(0, PropertyOrLabelExpressionContext)!;
    }
    public SP(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.SP, 0);
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_stringExpression;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterStringExpression) {
             listener.enterStringExpression(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitStringExpression) {
             listener.exitStringExpression(this);
        }
    }
}


export class StringExpPrefixContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public STARTS(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.STARTS, 0);
    }
    public WITH(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.WITH, 0);
    }
    public SP(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.SP, 0);
    }
    public ENDS(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.ENDS, 0);
    }
    public CONTAINS(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.CONTAINS, 0);
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_stringExpPrefix;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterStringExpPrefix) {
             listener.enterStringExpPrefix(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitStringExpPrefix) {
             listener.exitStringExpPrefix(this);
        }
    }
}


export class NullExpressionContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public IS(): antlr.TerminalNode {
        return this.getToken(CypherParser.IS, 0)!;
    }
    public NULL_W(): antlr.TerminalNode {
        return this.getToken(CypherParser.NULL_W, 0)!;
    }
    public SP(): antlr.TerminalNode[];
    public SP(i: number): antlr.TerminalNode | null;
    public SP(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(CypherParser.SP);
    	} else {
    		return this.getToken(CypherParser.SP, i);
    	}
    }
    public NOT(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.NOT, 0);
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_nullExpression;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterNullExpression) {
             listener.enterNullExpression(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitNullExpression) {
             listener.exitNullExpression(this);
        }
    }
}


export class PropertyOrLabelExpressionContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public propertyExpression(): PropertyExpressionContext {
        return this.getRuleContext(0, PropertyExpressionContext)!;
    }
    public nodeLabels(): NodeLabelsContext | null {
        return this.getRuleContext(0, NodeLabelsContext);
    }
    public SP(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.SP, 0);
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_propertyOrLabelExpression;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterPropertyOrLabelExpression) {
             listener.enterPropertyOrLabelExpression(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitPropertyOrLabelExpression) {
             listener.exitPropertyOrLabelExpression(this);
        }
    }
}


export class PropertyExpressionContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public atom(): AtomContext {
        return this.getRuleContext(0, AtomContext)!;
    }
    public DOT(): antlr.TerminalNode[];
    public DOT(i: number): antlr.TerminalNode | null;
    public DOT(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(CypherParser.DOT);
    	} else {
    		return this.getToken(CypherParser.DOT, i);
    	}
    }
    public name(): NameContext[];
    public name(i: number): NameContext | null;
    public name(i?: number): NameContext[] | NameContext | null {
        if (i === undefined) {
            return this.getRuleContexts(NameContext);
        }

        return this.getRuleContext(i, NameContext);
    }
    public SP(): antlr.TerminalNode[];
    public SP(i: number): antlr.TerminalNode | null;
    public SP(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(CypherParser.SP);
    	} else {
    		return this.getToken(CypherParser.SP, i);
    	}
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_propertyExpression;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterPropertyExpression) {
             listener.enterPropertyExpression(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitPropertyExpression) {
             listener.exitPropertyExpression(this);
        }
    }
}


export class PatternPartContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public patternElem(): PatternElemContext {
        return this.getRuleContext(0, PatternElemContext)!;
    }
    public symbol(): SymbolContext | null {
        return this.getRuleContext(0, SymbolContext);
    }
    public ASSIGN(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.ASSIGN, 0);
    }
    public SP(): antlr.TerminalNode[];
    public SP(i: number): antlr.TerminalNode | null;
    public SP(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(CypherParser.SP);
    	} else {
    		return this.getToken(CypherParser.SP, i);
    	}
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_patternPart;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterPatternPart) {
             listener.enterPatternPart(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitPatternPart) {
             listener.exitPatternPart(this);
        }
    }
}


export class PatternElemContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public nodePattern(): NodePatternContext | null {
        return this.getRuleContext(0, NodePatternContext);
    }
    public patternElemChain(): PatternElemChainContext[];
    public patternElemChain(i: number): PatternElemChainContext | null;
    public patternElemChain(i?: number): PatternElemChainContext[] | PatternElemChainContext | null {
        if (i === undefined) {
            return this.getRuleContexts(PatternElemChainContext);
        }

        return this.getRuleContext(i, PatternElemChainContext);
    }
    public SP(): antlr.TerminalNode[];
    public SP(i: number): antlr.TerminalNode | null;
    public SP(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(CypherParser.SP);
    	} else {
    		return this.getToken(CypherParser.SP, i);
    	}
    }
    public LPAREN(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.LPAREN, 0);
    }
    public patternElem(): PatternElemContext | null {
        return this.getRuleContext(0, PatternElemContext);
    }
    public RPAREN(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.RPAREN, 0);
    }
    public functionInvocation(): FunctionInvocationContext | null {
        return this.getRuleContext(0, FunctionInvocationContext);
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_patternElem;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterPatternElem) {
             listener.enterPatternElem(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitPatternElem) {
             listener.exitPatternElem(this);
        }
    }
}


export class PatternElemChainContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public relationshipPattern(): RelationshipPatternContext {
        return this.getRuleContext(0, RelationshipPatternContext)!;
    }
    public nodePattern(): NodePatternContext {
        return this.getRuleContext(0, NodePatternContext)!;
    }
    public SP(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.SP, 0);
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_patternElemChain;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterPatternElemChain) {
             listener.enterPatternElemChain(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitPatternElemChain) {
             listener.exitPatternElemChain(this);
        }
    }
}


export class PropertiesContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public mapLit(): MapLitContext | null {
        return this.getRuleContext(0, MapLitContext);
    }
    public parameter(): ParameterContext | null {
        return this.getRuleContext(0, ParameterContext);
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_properties;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterProperties) {
             listener.enterProperties(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitProperties) {
             listener.exitProperties(this);
        }
    }
}


export class NodePatternContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public LPAREN(): antlr.TerminalNode {
        return this.getToken(CypherParser.LPAREN, 0)!;
    }
    public RPAREN(): antlr.TerminalNode {
        return this.getToken(CypherParser.RPAREN, 0)!;
    }
    public SP(): antlr.TerminalNode[];
    public SP(i: number): antlr.TerminalNode | null;
    public SP(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(CypherParser.SP);
    	} else {
    		return this.getToken(CypherParser.SP, i);
    	}
    }
    public symbol(): SymbolContext | null {
        return this.getRuleContext(0, SymbolContext);
    }
    public nodeLabels(): NodeLabelsContext | null {
        return this.getRuleContext(0, NodeLabelsContext);
    }
    public properties(): PropertiesContext | null {
        return this.getRuleContext(0, PropertiesContext);
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_nodePattern;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterNodePattern) {
             listener.enterNodePattern(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitNodePattern) {
             listener.exitNodePattern(this);
        }
    }
}


export class AtomContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public literal(): LiteralContext | null {
        return this.getRuleContext(0, LiteralContext);
    }
    public parameter(): ParameterContext | null {
        return this.getRuleContext(0, ParameterContext);
    }
    public caseExpression(): CaseExpressionContext | null {
        return this.getRuleContext(0, CaseExpressionContext);
    }
    public countAll(): CountAllContext | null {
        return this.getRuleContext(0, CountAllContext);
    }
    public listComprehension(): ListComprehensionContext | null {
        return this.getRuleContext(0, ListComprehensionContext);
    }
    public patternComprehension(): PatternComprehensionContext | null {
        return this.getRuleContext(0, PatternComprehensionContext);
    }
    public filterWith(): FilterWithContext | null {
        return this.getRuleContext(0, FilterWithContext);
    }
    public relationshipsChainPattern(): RelationshipsChainPatternContext | null {
        return this.getRuleContext(0, RelationshipsChainPatternContext);
    }
    public parenthesizedExpression(): ParenthesizedExpressionContext | null {
        return this.getRuleContext(0, ParenthesizedExpressionContext);
    }
    public functionInvocation(): FunctionInvocationContext | null {
        return this.getRuleContext(0, FunctionInvocationContext);
    }
    public symbol(): SymbolContext | null {
        return this.getRuleContext(0, SymbolContext);
    }
    public subqueryExist(): SubqueryExistContext | null {
        return this.getRuleContext(0, SubqueryExistContext);
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_atom;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterAtom) {
             listener.enterAtom(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitAtom) {
             listener.exitAtom(this);
        }
    }
}


export class LhsContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public symbol(): SymbolContext {
        return this.getRuleContext(0, SymbolContext)!;
    }
    public ASSIGN(): antlr.TerminalNode {
        return this.getToken(CypherParser.ASSIGN, 0)!;
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_lhs;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterLhs) {
             listener.enterLhs(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitLhs) {
             listener.exitLhs(this);
        }
    }
}


export class RelationshipPatternContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public LT(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.LT, 0);
    }
    public SUB(): antlr.TerminalNode[];
    public SUB(i: number): antlr.TerminalNode | null;
    public SUB(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(CypherParser.SUB);
    	} else {
    		return this.getToken(CypherParser.SUB, i);
    	}
    }
    public SP(): antlr.TerminalNode[];
    public SP(i: number): antlr.TerminalNode | null;
    public SP(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(CypherParser.SP);
    	} else {
    		return this.getToken(CypherParser.SP, i);
    	}
    }
    public relationDetail(): RelationDetailContext | null {
        return this.getRuleContext(0, RelationDetailContext);
    }
    public GT(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.GT, 0);
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_relationshipPattern;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterRelationshipPattern) {
             listener.enterRelationshipPattern(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitRelationshipPattern) {
             listener.exitRelationshipPattern(this);
        }
    }
}


export class RelationDetailContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public LBRACK(): antlr.TerminalNode {
        return this.getToken(CypherParser.LBRACK, 0)!;
    }
    public RBRACK(): antlr.TerminalNode {
        return this.getToken(CypherParser.RBRACK, 0)!;
    }
    public SP(): antlr.TerminalNode[];
    public SP(i: number): antlr.TerminalNode | null;
    public SP(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(CypherParser.SP);
    	} else {
    		return this.getToken(CypherParser.SP, i);
    	}
    }
    public symbol(): SymbolContext | null {
        return this.getRuleContext(0, SymbolContext);
    }
    public relationshipTypes(): RelationshipTypesContext | null {
        return this.getRuleContext(0, RelationshipTypesContext);
    }
    public rangeLit(): RangeLitContext | null {
        return this.getRuleContext(0, RangeLitContext);
    }
    public properties(): PropertiesContext | null {
        return this.getRuleContext(0, PropertiesContext);
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_relationDetail;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterRelationDetail) {
             listener.enterRelationDetail(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitRelationDetail) {
             listener.exitRelationDetail(this);
        }
    }
}


export class RangeLitContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public MULT(): antlr.TerminalNode {
        return this.getToken(CypherParser.MULT, 0)!;
    }
    public SP(): antlr.TerminalNode[];
    public SP(i: number): antlr.TerminalNode | null;
    public SP(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(CypherParser.SP);
    	} else {
    		return this.getToken(CypherParser.SP, i);
    	}
    }
    public Integer(): antlr.TerminalNode[];
    public Integer(i: number): antlr.TerminalNode | null;
    public Integer(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(CypherParser.Integer);
    	} else {
    		return this.getToken(CypherParser.Integer, i);
    	}
    }
    public RANGE(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.RANGE, 0);
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_rangeLit;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterRangeLit) {
             listener.enterRangeLit(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitRangeLit) {
             listener.exitRangeLit(this);
        }
    }
}


export class RelationshipTypesContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public COLON(): antlr.TerminalNode[];
    public COLON(i: number): antlr.TerminalNode | null;
    public COLON(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(CypherParser.COLON);
    	} else {
    		return this.getToken(CypherParser.COLON, i);
    	}
    }
    public name(): NameContext[];
    public name(i: number): NameContext | null;
    public name(i?: number): NameContext[] | NameContext | null {
        if (i === undefined) {
            return this.getRuleContexts(NameContext);
        }

        return this.getRuleContext(i, NameContext);
    }
    public SP(): antlr.TerminalNode[];
    public SP(i: number): antlr.TerminalNode | null;
    public SP(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(CypherParser.SP);
    	} else {
    		return this.getToken(CypherParser.SP, i);
    	}
    }
    public STICK(): antlr.TerminalNode[];
    public STICK(i: number): antlr.TerminalNode | null;
    public STICK(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(CypherParser.STICK);
    	} else {
    		return this.getToken(CypherParser.STICK, i);
    	}
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_relationshipTypes;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterRelationshipTypes) {
             listener.enterRelationshipTypes(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitRelationshipTypes) {
             listener.exitRelationshipTypes(this);
        }
    }
}


export class UnionStContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public UNION(): antlr.TerminalNode {
        return this.getToken(CypherParser.UNION, 0)!;
    }
    public singleQuery(): SingleQueryContext {
        return this.getRuleContext(0, SingleQueryContext)!;
    }
    public SP(): antlr.TerminalNode[];
    public SP(i: number): antlr.TerminalNode | null;
    public SP(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(CypherParser.SP);
    	} else {
    		return this.getToken(CypherParser.SP, i);
    	}
    }
    public ALL(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.ALL, 0);
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_unionSt;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterUnionSt) {
             listener.enterUnionSt(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitUnionSt) {
             listener.exitUnionSt(this);
        }
    }
}


export class SubqueryExistContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public EXISTS(): antlr.TerminalNode {
        return this.getToken(CypherParser.EXISTS, 0)!;
    }
    public LBRACE(): antlr.TerminalNode {
        return this.getToken(CypherParser.LBRACE, 0)!;
    }
    public RBRACE(): antlr.TerminalNode {
        return this.getToken(CypherParser.RBRACE, 0)!;
    }
    public regularQuery(): RegularQueryContext | null {
        return this.getRuleContext(0, RegularQueryContext);
    }
    public patternWhere(): PatternWhereContext | null {
        return this.getRuleContext(0, PatternWhereContext);
    }
    public SP(): antlr.TerminalNode[];
    public SP(i: number): antlr.TerminalNode | null;
    public SP(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(CypherParser.SP);
    	} else {
    		return this.getToken(CypherParser.SP, i);
    	}
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_subqueryExist;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterSubqueryExist) {
             listener.enterSubqueryExist(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitSubqueryExist) {
             listener.exitSubqueryExist(this);
        }
    }
}


export class InvocationNameContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public symbol_(): SymbolContext[];
    public symbol_(i: number): SymbolContext | null;
    public symbol_(i?: number): SymbolContext[] | SymbolContext | null {
        if (i === undefined) {
            return this.getRuleContexts(SymbolContext);
        }

        return this.getRuleContext(i, SymbolContext);
    }
    public DOT(): antlr.TerminalNode[];
    public DOT(i: number): antlr.TerminalNode | null;
    public DOT(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(CypherParser.DOT);
    	} else {
    		return this.getToken(CypherParser.DOT, i);
    	}
    }
    public SP(): antlr.TerminalNode[];
    public SP(i: number): antlr.TerminalNode | null;
    public SP(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(CypherParser.SP);
    	} else {
    		return this.getToken(CypherParser.SP, i);
    	}
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_invocationName;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterInvocationName) {
             listener.enterInvocationName(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitInvocationName) {
             listener.exitInvocationName(this);
        }
    }
}


export class FunctionInvocationContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public invocationName(): InvocationNameContext {
        return this.getRuleContext(0, InvocationNameContext)!;
    }
    public LPAREN(): antlr.TerminalNode {
        return this.getToken(CypherParser.LPAREN, 0)!;
    }
    public patternElem(): PatternElemContext | null {
        return this.getRuleContext(0, PatternElemContext);
    }
    public RPAREN(): antlr.TerminalNode {
        return this.getToken(CypherParser.RPAREN, 0)!;
    }
    public SP(): antlr.TerminalNode[];
    public SP(i: number): antlr.TerminalNode | null;
    public SP(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(CypherParser.SP);
    	} else {
    		return this.getToken(CypherParser.SP, i);
    	}
    }
    public DISTINCT(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.DISTINCT, 0);
    }
    public expressionChain(): ExpressionChainContext | null {
        return this.getRuleContext(0, ExpressionChainContext);
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_functionInvocation;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterFunctionInvocation) {
             listener.enterFunctionInvocation(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitFunctionInvocation) {
             listener.exitFunctionInvocation(this);
        }
    }
}


export class ParenthesizedExpressionContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public LPAREN(): antlr.TerminalNode {
        return this.getToken(CypherParser.LPAREN, 0)!;
    }
    public expression(): ExpressionContext {
        return this.getRuleContext(0, ExpressionContext)!;
    }
    public RPAREN(): antlr.TerminalNode {
        return this.getToken(CypherParser.RPAREN, 0)!;
    }
    public SP(): antlr.TerminalNode[];
    public SP(i: number): antlr.TerminalNode | null;
    public SP(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(CypherParser.SP);
    	} else {
    		return this.getToken(CypherParser.SP, i);
    	}
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_parenthesizedExpression;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterParenthesizedExpression) {
             listener.enterParenthesizedExpression(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitParenthesizedExpression) {
             listener.exitParenthesizedExpression(this);
        }
    }
}


export class FilterWithContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public LPAREN(): antlr.TerminalNode {
        return this.getToken(CypherParser.LPAREN, 0)!;
    }
    public filterExpression(): FilterExpressionContext {
        return this.getRuleContext(0, FilterExpressionContext)!;
    }
    public RPAREN(): antlr.TerminalNode {
        return this.getToken(CypherParser.RPAREN, 0)!;
    }
    public ALL(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.ALL, 0);
    }
    public ANY(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.ANY, 0);
    }
    public NONE(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.NONE, 0);
    }
    public SINGLE(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.SINGLE, 0);
    }
    public SP(): antlr.TerminalNode[];
    public SP(i: number): antlr.TerminalNode | null;
    public SP(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(CypherParser.SP);
    	} else {
    		return this.getToken(CypherParser.SP, i);
    	}
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_filterWith;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterFilterWith) {
             listener.enterFilterWith(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitFilterWith) {
             listener.exitFilterWith(this);
        }
    }
}


export class PatternComprehensionContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public LBRACK(): antlr.TerminalNode {
        return this.getToken(CypherParser.LBRACK, 0)!;
    }
    public relationshipsChainPattern(): RelationshipsChainPatternContext {
        return this.getRuleContext(0, RelationshipsChainPatternContext)!;
    }
    public STICK(): antlr.TerminalNode {
        return this.getToken(CypherParser.STICK, 0)!;
    }
    public expression(): ExpressionContext {
        return this.getRuleContext(0, ExpressionContext)!;
    }
    public RBRACK(): antlr.TerminalNode {
        return this.getToken(CypherParser.RBRACK, 0)!;
    }
    public SP(): antlr.TerminalNode[];
    public SP(i: number): antlr.TerminalNode | null;
    public SP(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(CypherParser.SP);
    	} else {
    		return this.getToken(CypherParser.SP, i);
    	}
    }
    public lhs(): LhsContext | null {
        return this.getRuleContext(0, LhsContext);
    }
    public ASSIGN(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.ASSIGN, 0);
    }
    public where(): WhereContext | null {
        return this.getRuleContext(0, WhereContext);
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_patternComprehension;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterPatternComprehension) {
             listener.enterPatternComprehension(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitPatternComprehension) {
             listener.exitPatternComprehension(this);
        }
    }
}


export class RelationshipsChainPatternContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public nodePattern(): NodePatternContext {
        return this.getRuleContext(0, NodePatternContext)!;
    }
    public patternElemChain(): PatternElemChainContext[];
    public patternElemChain(i: number): PatternElemChainContext | null;
    public patternElemChain(i?: number): PatternElemChainContext[] | PatternElemChainContext | null {
        if (i === undefined) {
            return this.getRuleContexts(PatternElemChainContext);
        }

        return this.getRuleContext(i, PatternElemChainContext);
    }
    public SP(): antlr.TerminalNode[];
    public SP(i: number): antlr.TerminalNode | null;
    public SP(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(CypherParser.SP);
    	} else {
    		return this.getToken(CypherParser.SP, i);
    	}
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_relationshipsChainPattern;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterRelationshipsChainPattern) {
             listener.enterRelationshipsChainPattern(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitRelationshipsChainPattern) {
             listener.exitRelationshipsChainPattern(this);
        }
    }
}


export class ListComprehensionContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public LBRACK(): antlr.TerminalNode {
        return this.getToken(CypherParser.LBRACK, 0)!;
    }
    public filterExpression(): FilterExpressionContext {
        return this.getRuleContext(0, FilterExpressionContext)!;
    }
    public RBRACK(): antlr.TerminalNode {
        return this.getToken(CypherParser.RBRACK, 0)!;
    }
    public SP(): antlr.TerminalNode[];
    public SP(i: number): antlr.TerminalNode | null;
    public SP(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(CypherParser.SP);
    	} else {
    		return this.getToken(CypherParser.SP, i);
    	}
    }
    public STICK(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.STICK, 0);
    }
    public expression(): ExpressionContext | null {
        return this.getRuleContext(0, ExpressionContext);
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_listComprehension;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterListComprehension) {
             listener.enterListComprehension(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitListComprehension) {
             listener.exitListComprehension(this);
        }
    }
}


export class FilterExpressionContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public symbol(): SymbolContext {
        return this.getRuleContext(0, SymbolContext)!;
    }
    public IN(): antlr.TerminalNode {
        return this.getToken(CypherParser.IN, 0)!;
    }
    public expression(): ExpressionContext {
        return this.getRuleContext(0, ExpressionContext)!;
    }
    public SP(): antlr.TerminalNode[];
    public SP(i: number): antlr.TerminalNode | null;
    public SP(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(CypherParser.SP);
    	} else {
    		return this.getToken(CypherParser.SP, i);
    	}
    }
    public where(): WhereContext | null {
        return this.getRuleContext(0, WhereContext);
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_filterExpression;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterFilterExpression) {
             listener.enterFilterExpression(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitFilterExpression) {
             listener.exitFilterExpression(this);
        }
    }
}


export class CountAllContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public COUNT(): antlr.TerminalNode {
        return this.getToken(CypherParser.COUNT, 0)!;
    }
    public LPAREN(): antlr.TerminalNode {
        return this.getToken(CypherParser.LPAREN, 0)!;
    }
    public MULT(): antlr.TerminalNode {
        return this.getToken(CypherParser.MULT, 0)!;
    }
    public RPAREN(): antlr.TerminalNode {
        return this.getToken(CypherParser.RPAREN, 0)!;
    }
    public SP(): antlr.TerminalNode[];
    public SP(i: number): antlr.TerminalNode | null;
    public SP(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(CypherParser.SP);
    	} else {
    		return this.getToken(CypherParser.SP, i);
    	}
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_countAll;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterCountAll) {
             listener.enterCountAll(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitCountAll) {
             listener.exitCountAll(this);
        }
    }
}


export class ExpressionChainContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public expression(): ExpressionContext[];
    public expression(i: number): ExpressionContext | null;
    public expression(i?: number): ExpressionContext[] | ExpressionContext | null {
        if (i === undefined) {
            return this.getRuleContexts(ExpressionContext);
        }

        return this.getRuleContext(i, ExpressionContext);
    }
    public COMMA(): antlr.TerminalNode[];
    public COMMA(i: number): antlr.TerminalNode | null;
    public COMMA(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(CypherParser.COMMA);
    	} else {
    		return this.getToken(CypherParser.COMMA, i);
    	}
    }
    public SP(): antlr.TerminalNode[];
    public SP(i: number): antlr.TerminalNode | null;
    public SP(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(CypherParser.SP);
    	} else {
    		return this.getToken(CypherParser.SP, i);
    	}
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_expressionChain;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterExpressionChain) {
             listener.enterExpressionChain(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitExpressionChain) {
             listener.exitExpressionChain(this);
        }
    }
}


export class CaseExpressionContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public CASE(): antlr.TerminalNode {
        return this.getToken(CypherParser.CASE, 0)!;
    }
    public END(): antlr.TerminalNode {
        return this.getToken(CypherParser.END, 0)!;
    }
    public SP(): antlr.TerminalNode[];
    public SP(i: number): antlr.TerminalNode | null;
    public SP(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(CypherParser.SP);
    	} else {
    		return this.getToken(CypherParser.SP, i);
    	}
    }
    public expression(): ExpressionContext[];
    public expression(i: number): ExpressionContext | null;
    public expression(i?: number): ExpressionContext[] | ExpressionContext | null {
        if (i === undefined) {
            return this.getRuleContexts(ExpressionContext);
        }

        return this.getRuleContext(i, ExpressionContext);
    }
    public WHEN(): antlr.TerminalNode[];
    public WHEN(i: number): antlr.TerminalNode | null;
    public WHEN(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(CypherParser.WHEN);
    	} else {
    		return this.getToken(CypherParser.WHEN, i);
    	}
    }
    public THEN(): antlr.TerminalNode[];
    public THEN(i: number): antlr.TerminalNode | null;
    public THEN(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(CypherParser.THEN);
    	} else {
    		return this.getToken(CypherParser.THEN, i);
    	}
    }
    public ELSE(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.ELSE, 0);
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_caseExpression;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterCaseExpression) {
             listener.enterCaseExpression(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitCaseExpression) {
             listener.exitCaseExpression(this);
        }
    }
}


export class ParameterContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public DOLLAR(): antlr.TerminalNode {
        return this.getToken(CypherParser.DOLLAR, 0)!;
    }
    public symbol(): SymbolContext | null {
        return this.getRuleContext(0, SymbolContext);
    }
    public numLit(): NumLitContext | null {
        return this.getRuleContext(0, NumLitContext);
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_parameter;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterParameter) {
             listener.enterParameter(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitParameter) {
             listener.exitParameter(this);
        }
    }
}


export class LiteralContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public boolLit(): BoolLitContext | null {
        return this.getRuleContext(0, BoolLitContext);
    }
    public numLit(): NumLitContext | null {
        return this.getRuleContext(0, NumLitContext);
    }
    public NULL_W(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.NULL_W, 0);
    }
    public stringLit(): StringLitContext | null {
        return this.getRuleContext(0, StringLitContext);
    }
    public charLit(): CharLitContext | null {
        return this.getRuleContext(0, CharLitContext);
    }
    public listLit(): ListLitContext | null {
        return this.getRuleContext(0, ListLitContext);
    }
    public mapLit(): MapLitContext | null {
        return this.getRuleContext(0, MapLitContext);
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_literal;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterLiteral) {
             listener.enterLiteral(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitLiteral) {
             listener.exitLiteral(this);
        }
    }
}


export class BoolLitContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public TRUE(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.TRUE, 0);
    }
    public FALSE(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.FALSE, 0);
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_boolLit;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterBoolLit) {
             listener.enterBoolLit(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitBoolLit) {
             listener.exitBoolLit(this);
        }
    }
}


export class NumLitContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public DIGIT(): antlr.TerminalNode {
        return this.getToken(CypherParser.DIGIT, 0)!;
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_numLit;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterNumLit) {
             listener.enterNumLit(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitNumLit) {
             listener.exitNumLit(this);
        }
    }
}


export class StringLitContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public STRING_LITERAL(): antlr.TerminalNode {
        return this.getToken(CypherParser.STRING_LITERAL, 0)!;
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_stringLit;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterStringLit) {
             listener.enterStringLit(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitStringLit) {
             listener.exitStringLit(this);
        }
    }
}


export class CharLitContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public CHAR_LITERAL(): antlr.TerminalNode {
        return this.getToken(CypherParser.CHAR_LITERAL, 0)!;
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_charLit;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterCharLit) {
             listener.enterCharLit(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitCharLit) {
             listener.exitCharLit(this);
        }
    }
}


export class ListLitContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public LBRACK(): antlr.TerminalNode {
        return this.getToken(CypherParser.LBRACK, 0)!;
    }
    public RBRACK(): antlr.TerminalNode {
        return this.getToken(CypherParser.RBRACK, 0)!;
    }
    public SP(): antlr.TerminalNode[];
    public SP(i: number): antlr.TerminalNode | null;
    public SP(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(CypherParser.SP);
    	} else {
    		return this.getToken(CypherParser.SP, i);
    	}
    }
    public expressionChain(): ExpressionChainContext | null {
        return this.getRuleContext(0, ExpressionChainContext);
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_listLit;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterListLit) {
             listener.enterListLit(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitListLit) {
             listener.exitListLit(this);
        }
    }
}


export class MapLitContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public LBRACE(): antlr.TerminalNode {
        return this.getToken(CypherParser.LBRACE, 0)!;
    }
    public RBRACE(): antlr.TerminalNode {
        return this.getToken(CypherParser.RBRACE, 0)!;
    }
    public SP(): antlr.TerminalNode[];
    public SP(i: number): antlr.TerminalNode | null;
    public SP(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(CypherParser.SP);
    	} else {
    		return this.getToken(CypherParser.SP, i);
    	}
    }
    public mapPair(): MapPairContext[];
    public mapPair(i: number): MapPairContext | null;
    public mapPair(i?: number): MapPairContext[] | MapPairContext | null {
        if (i === undefined) {
            return this.getRuleContexts(MapPairContext);
        }

        return this.getRuleContext(i, MapPairContext);
    }
    public COMMA(): antlr.TerminalNode[];
    public COMMA(i: number): antlr.TerminalNode | null;
    public COMMA(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(CypherParser.COMMA);
    	} else {
    		return this.getToken(CypherParser.COMMA, i);
    	}
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_mapLit;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterMapLit) {
             listener.enterMapLit(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitMapLit) {
             listener.exitMapLit(this);
        }
    }
}


export class MapPairContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public name(): NameContext {
        return this.getRuleContext(0, NameContext)!;
    }
    public COLON(): antlr.TerminalNode {
        return this.getToken(CypherParser.COLON, 0)!;
    }
    public expression(): ExpressionContext {
        return this.getRuleContext(0, ExpressionContext)!;
    }
    public SP(): antlr.TerminalNode[];
    public SP(i: number): antlr.TerminalNode | null;
    public SP(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(CypherParser.SP);
    	} else {
    		return this.getToken(CypherParser.SP, i);
    	}
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_mapPair;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterMapPair) {
             listener.enterMapPair(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitMapPair) {
             listener.exitMapPair(this);
        }
    }
}


export class NameContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public symbol(): SymbolContext | null {
        return this.getRuleContext(0, SymbolContext);
    }
    public reservedWord(): ReservedWordContext | null {
        return this.getRuleContext(0, ReservedWordContext);
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_name;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterName) {
             listener.enterName(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitName) {
             listener.exitName(this);
        }
    }
}


export class SymbolContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public ESC_LITERAL(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.ESC_LITERAL, 0);
    }
    public Integer(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.Integer, 0);
    }
    public DIGIT(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.DIGIT, 0);
    }
    public ID(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.ID, 0);
    }
    public COUNT(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.COUNT, 0);
    }
    public FILTER(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.FILTER, 0);
    }
    public EXTRACT(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.EXTRACT, 0);
    }
    public ANY(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.ANY, 0);
    }
    public NONE(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.NONE, 0);
    }
    public SINGLE(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.SINGLE, 0);
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_symbol;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterSymbol) {
             listener.enterSymbol(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitSymbol) {
             listener.exitSymbol(this);
        }
    }
}


export class ReservedWordContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public ALL(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.ALL, 0);
    }
    public ASC(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.ASC, 0);
    }
    public ASCENDING(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.ASCENDING, 0);
    }
    public BY(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.BY, 0);
    }
    public CREATE(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.CREATE, 0);
    }
    public DELETE(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.DELETE, 0);
    }
    public DESC(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.DESC, 0);
    }
    public DESCENDING(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.DESCENDING, 0);
    }
    public DETACH(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.DETACH, 0);
    }
    public EXISTS(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.EXISTS, 0);
    }
    public LIMIT(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.LIMIT, 0);
    }
    public MATCH(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.MATCH, 0);
    }
    public MERGE(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.MERGE, 0);
    }
    public ON(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.ON, 0);
    }
    public OPTIONAL(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.OPTIONAL, 0);
    }
    public ORDER(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.ORDER, 0);
    }
    public REMOVE(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.REMOVE, 0);
    }
    public RETURN(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.RETURN, 0);
    }
    public SET(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.SET, 0);
    }
    public SKIP_W(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.SKIP_W, 0);
    }
    public WHERE(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.WHERE, 0);
    }
    public WITH(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.WITH, 0);
    }
    public UNION(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.UNION, 0);
    }
    public UNWIND(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.UNWIND, 0);
    }
    public AND(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.AND, 0);
    }
    public AS(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.AS, 0);
    }
    public CONTAINS(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.CONTAINS, 0);
    }
    public DISTINCT(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.DISTINCT, 0);
    }
    public ENDS(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.ENDS, 0);
    }
    public IN(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.IN, 0);
    }
    public IS(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.IS, 0);
    }
    public NOT(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.NOT, 0);
    }
    public OR(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.OR, 0);
    }
    public STARTS(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.STARTS, 0);
    }
    public XOR(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.XOR, 0);
    }
    public FALSE(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.FALSE, 0);
    }
    public TRUE(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.TRUE, 0);
    }
    public NULL_W(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.NULL_W, 0);
    }
    public CONSTRAINT(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.CONSTRAINT, 0);
    }
    public DO(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.DO, 0);
    }
    public FOR(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.FOR, 0);
    }
    public REQUIRE(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.REQUIRE, 0);
    }
    public UNIQUE(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.UNIQUE, 0);
    }
    public CASE(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.CASE, 0);
    }
    public WHEN(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.WHEN, 0);
    }
    public THEN(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.THEN, 0);
    }
    public ELSE(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.ELSE, 0);
    }
    public END(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.END, 0);
    }
    public MANDATORY(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.MANDATORY, 0);
    }
    public SCALAR(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.SCALAR, 0);
    }
    public OF(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.OF, 0);
    }
    public ADD(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.ADD, 0);
    }
    public DROP(): antlr.TerminalNode | null {
        return this.getToken(CypherParser.DROP, 0);
    }
    public override get ruleIndex(): number {
        return CypherParser.RULE_reservedWord;
    }
    public override enterRule(listener: CypherParserListener): void {
        if(listener.enterReservedWord) {
             listener.enterReservedWord(this);
        }
    }
    public override exitRule(listener: CypherParserListener): void {
        if(listener.exitReservedWord) {
             listener.exitReservedWord(this);
        }
    }
}
