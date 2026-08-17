
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
            let alternative: number;
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 197;
            this.singleQuery();
            this.state = 204;
            this.errorHandler.sync(this);
            alternative = this.interpreter.adaptivePredict(this.tokenStream, 6, this.context);
            while (alternative !== 2 && alternative !== antlr.ATN.INVALID_ALT_NUMBER) {
                if (alternative === 1) {
                    {
                    {
                    this.state = 199;
                    this.errorHandler.sync(this);
                    _la = this.tokenStream.LA(1);
                    if (_la === 99) {
                        {
                        this.state = 198;
                        this.match(CypherParser.SP);
                        }
                    }

                    this.state = 201;
                    this.unionSt();
                    }
                    }
                }
                this.state = 206;
                this.errorHandler.sync(this);
                alternative = this.interpreter.adaptivePredict(this.tokenStream, 6, this.context);
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
            this.state = 209;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 7, this.context) ) {
            case 1:
                this.enterOuterAlt(localContext, 1);
                {
                this.state = 207;
                this.singlePartQ();
                }
                break;
            case 2:
                this.enterOuterAlt(localContext, 2);
                {
                this.state = 208;
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
            this.state = 211;
            this.match(CypherParser.CALL);
            this.state = 213;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 212;
                this.match(CypherParser.SP);
                }
            }

            this.state = 215;
            this.invocationName();
            this.state = 217;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 9, this.context) ) {
            case 1:
                {
                this.state = 216;
                this.match(CypherParser.SP);
                }
                break;
            }
            this.state = 220;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 12) {
                {
                this.state = 219;
                this.parenExpressionChain();
                }
            }

            this.state = 233;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 14, this.context) ) {
            case 1:
                {
                this.state = 223;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 222;
                    this.match(CypherParser.SP);
                    }
                }

                this.state = 225;
                this.match(CypherParser.YIELD);
                this.state = 227;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 226;
                    this.match(CypherParser.SP);
                    }
                }

                this.state = 231;
                this.errorHandler.sync(this);
                switch (this.tokenStream.LA(1)) {
                case CypherParser.MULT:
                    {
                    this.state = 229;
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
                    this.state = 230;
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
            this.state = 235;
            this.match(CypherParser.RETURN);
            this.state = 237;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 15, this.context) ) {
            case 1:
                {
                this.state = 236;
                this.match(CypherParser.SP);
                }
                break;
            }
            this.state = 239;
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
            this.state = 241;
            this.match(CypherParser.WITH);
            this.state = 243;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 16, this.context) ) {
            case 1:
                {
                this.state = 242;
                this.match(CypherParser.SP);
                }
                break;
            }
            this.state = 245;
            this.projectionBody();
            this.state = 250;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 18, this.context) ) {
            case 1:
                {
                this.state = 247;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 246;
                    this.match(CypherParser.SP);
                    }
                }

                this.state = 249;
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
            this.state = 252;
            this.match(CypherParser.SKIP_W);
            this.state = 254;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 19, this.context) ) {
            case 1:
                {
                this.state = 253;
                this.match(CypherParser.SP);
                }
                break;
            }
            this.state = 256;
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
            this.state = 258;
            this.match(CypherParser.LIMIT);
            this.state = 260;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 20, this.context) ) {
            case 1:
                {
                this.state = 259;
                this.match(CypherParser.SP);
                }
                break;
            }
            this.state = 262;
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
            this.state = 268;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 22, this.context) ) {
            case 1:
                {
                this.state = 265;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 264;
                    this.match(CypherParser.SP);
                    }
                }

                this.state = 267;
                this.match(CypherParser.DISTINCT);
                }
                break;
            }
            this.state = 271;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 23, this.context) ) {
            case 1:
                {
                this.state = 270;
                this.match(CypherParser.SP);
                }
                break;
            }
            this.state = 273;
            this.projectionItems();
            this.state = 278;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 25, this.context) ) {
            case 1:
                {
                this.state = 275;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 274;
                    this.match(CypherParser.SP);
                    }
                }

                this.state = 277;
                this.orderSt();
                }
                break;
            }
            this.state = 284;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 27, this.context) ) {
            case 1:
                {
                this.state = 281;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 280;
                    this.match(CypherParser.SP);
                    }
                }

                this.state = 283;
                this.skipSt();
                }
                break;
            }
            this.state = 290;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 29, this.context) ) {
            case 1:
                {
                this.state = 287;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 286;
                    this.match(CypherParser.SP);
                    }
                }

                this.state = 289;
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
            this.state = 294;
            this.errorHandler.sync(this);
            switch (this.tokenStream.LA(1)) {
            case CypherParser.MULT:
                {
                this.state = 292;
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
                this.state = 293;
                this.projectionItem();
                }
                break;
            default:
                throw new antlr.NoViableAltException(this);
            }
            this.state = 306;
            this.errorHandler.sync(this);
            alternative = this.interpreter.adaptivePredict(this.tokenStream, 33, this.context);
            while (alternative !== 2 && alternative !== antlr.ATN.INVALID_ALT_NUMBER) {
                if (alternative === 1) {
                    {
                    {
                    this.state = 297;
                    this.errorHandler.sync(this);
                    _la = this.tokenStream.LA(1);
                    if (_la === 99) {
                        {
                        this.state = 296;
                        this.match(CypherParser.SP);
                        }
                    }

                    this.state = 299;
                    this.match(CypherParser.COMMA);
                    this.state = 301;
                    this.errorHandler.sync(this);
                    switch (this.interpreter.adaptivePredict(this.tokenStream, 32, this.context) ) {
                    case 1:
                        {
                        this.state = 300;
                        this.match(CypherParser.SP);
                        }
                        break;
                    }
                    this.state = 303;
                    this.projectionItem();
                    }
                    }
                }
                this.state = 308;
                this.errorHandler.sync(this);
                alternative = this.interpreter.adaptivePredict(this.tokenStream, 33, this.context);
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
            this.state = 309;
            this.expression();
            this.state = 318;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 36, this.context) ) {
            case 1:
                {
                this.state = 311;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 310;
                    this.match(CypherParser.SP);
                    }
                }

                this.state = 313;
                this.match(CypherParser.AS);
                this.state = 315;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 314;
                    this.match(CypherParser.SP);
                    }
                }

                this.state = 317;
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
            this.state = 320;
            this.expression();
            this.state = 325;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 38, this.context) ) {
            case 1:
                {
                this.state = 322;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 321;
                    this.match(CypherParser.SP);
                    }
                }

                this.state = 324;
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
            this.state = 327;
            this.match(CypherParser.ORDER);
            this.state = 329;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 328;
                this.match(CypherParser.SP);
                }
            }

            this.state = 331;
            this.match(CypherParser.BY);
            this.state = 333;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 40, this.context) ) {
            case 1:
                {
                this.state = 332;
                this.match(CypherParser.SP);
                }
                break;
            }
            this.state = 335;
            this.orderItem();
            this.state = 346;
            this.errorHandler.sync(this);
            alternative = this.interpreter.adaptivePredict(this.tokenStream, 43, this.context);
            while (alternative !== 2 && alternative !== antlr.ATN.INVALID_ALT_NUMBER) {
                if (alternative === 1) {
                    {
                    {
                    this.state = 337;
                    this.errorHandler.sync(this);
                    _la = this.tokenStream.LA(1);
                    if (_la === 99) {
                        {
                        this.state = 336;
                        this.match(CypherParser.SP);
                        }
                    }

                    this.state = 339;
                    this.match(CypherParser.COMMA);
                    this.state = 341;
                    this.errorHandler.sync(this);
                    switch (this.interpreter.adaptivePredict(this.tokenStream, 42, this.context) ) {
                    case 1:
                        {
                        this.state = 340;
                        this.match(CypherParser.SP);
                        }
                        break;
                    }
                    this.state = 343;
                    this.orderItem();
                    }
                    }
                }
                this.state = 348;
                this.errorHandler.sync(this);
                alternative = this.interpreter.adaptivePredict(this.tokenStream, 43, this.context);
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
            this.state = 355;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            while (((((_la - 28)) & ~0x1F) === 0 && ((1 << (_la - 28)) & 2152202241) !== 0)) {
                {
                {
                this.state = 349;
                this.readingStatement();
                this.state = 351;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 350;
                    this.match(CypherParser.SP);
                    }
                }

                }
                }
                this.state = 357;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
            }
            this.state = 373;
            this.errorHandler.sync(this);
            switch (this.tokenStream.LA(1)) {
            case CypherParser.RETURN:
                {
                this.state = 358;
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
                this.state = 363;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                do {
                    {
                    {
                    this.state = 359;
                    this.updatingStatement();
                    this.state = 361;
                    this.errorHandler.sync(this);
                    switch (this.interpreter.adaptivePredict(this.tokenStream, 46, this.context) ) {
                    case 1:
                        {
                        this.state = 360;
                        this.match(CypherParser.SP);
                        }
                        break;
                    }
                    }
                    }
                    this.state = 365;
                    this.errorHandler.sync(this);
                    _la = this.tokenStream.LA(1);
                } while (((((_la - 40)) & ~0x1F) === 0 && ((1 << (_la - 40)) & 20755) !== 0));
                this.state = 371;
                this.errorHandler.sync(this);
                switch (this.interpreter.adaptivePredict(this.tokenStream, 49, this.context) ) {
                case 1:
                    {
                    this.state = 368;
                    this.errorHandler.sync(this);
                    _la = this.tokenStream.LA(1);
                    if (_la === 99) {
                        {
                        this.state = 367;
                        this.match(CypherParser.SP);
                        }
                    }

                    this.state = 370;
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
            this.state = 381;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            while (((((_la - 28)) & ~0x1F) === 0 && ((1 << (_la - 28)) & 2152202241) !== 0)) {
                {
                {
                this.state = 375;
                this.readingStatement();
                this.state = 377;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 376;
                    this.match(CypherParser.SP);
                    }
                }

                }
                }
                this.state = 383;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
            }
            this.state = 390;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            while (((((_la - 40)) & ~0x1F) === 0 && ((1 << (_la - 40)) & 20755) !== 0)) {
                {
                {
                this.state = 384;
                this.updatingStatement();
                this.state = 386;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 385;
                    this.match(CypherParser.SP);
                    }
                }

                }
                }
                this.state = 392;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
            }
            this.state = 393;
            this.withSt();
            this.state = 395;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 394;
                this.match(CypherParser.SP);
                }
            }

            this.state = 397;
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
            this.state = 401;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 50) {
                {
                this.state = 399;
                this.match(CypherParser.OPTIONAL);
                this.state = 400;
                this.match(CypherParser.SP);
                }
            }

            this.state = 403;
            this.match(CypherParser.MATCH);
            this.state = 405;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 404;
                this.match(CypherParser.SP);
                }
            }

            this.state = 407;
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
            this.state = 409;
            this.match(CypherParser.UNWIND);
            this.state = 411;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 58, this.context) ) {
            case 1:
                {
                this.state = 410;
                this.match(CypherParser.SP);
                }
                break;
            }
            this.state = 413;
            this.expression();
            this.state = 415;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 414;
                this.match(CypherParser.SP);
                }
            }

            this.state = 417;
            this.match(CypherParser.AS);
            this.state = 419;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 418;
                this.match(CypherParser.SP);
                }
            }

            this.state = 421;
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
            this.state = 426;
            this.errorHandler.sync(this);
            switch (this.tokenStream.LA(1)) {
            case CypherParser.MATCH:
            case CypherParser.OPTIONAL:
                this.enterOuterAlt(localContext, 1);
                {
                this.state = 423;
                this.matchSt();
                }
                break;
            case CypherParser.UNWIND:
                this.enterOuterAlt(localContext, 2);
                {
                this.state = 424;
                this.unwindSt();
                }
                break;
            case CypherParser.CALL:
                this.enterOuterAlt(localContext, 3);
                {
                this.state = 425;
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
            this.state = 433;
            this.errorHandler.sync(this);
            switch (this.tokenStream.LA(1)) {
            case CypherParser.CREATE:
                this.enterOuterAlt(localContext, 1);
                {
                this.state = 428;
                this.createSt();
                }
                break;
            case CypherParser.MERGE:
                this.enterOuterAlt(localContext, 2);
                {
                this.state = 429;
                this.mergeSt();
                }
                break;
            case CypherParser.DELETE:
            case CypherParser.DETACH:
                this.enterOuterAlt(localContext, 3);
                {
                this.state = 430;
                this.deleteSt();
                }
                break;
            case CypherParser.SET:
                this.enterOuterAlt(localContext, 4);
                {
                this.state = 431;
                this.setSt();
                }
                break;
            case CypherParser.REMOVE:
                this.enterOuterAlt(localContext, 5);
                {
                this.state = 432;
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
            this.state = 437;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 44) {
                {
                this.state = 435;
                this.match(CypherParser.DETACH);
                this.state = 436;
                this.match(CypherParser.SP);
                }
            }

            this.state = 439;
            this.match(CypherParser.DELETE);
            this.state = 441;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 64, this.context) ) {
            case 1:
                {
                this.state = 440;
                this.match(CypherParser.SP);
                }
                break;
            }
            this.state = 443;
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
            this.state = 445;
            this.match(CypherParser.REMOVE);
            this.state = 447;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 446;
                this.match(CypherParser.SP);
                }
            }

            this.state = 449;
            this.removeItem();
            this.state = 460;
            this.errorHandler.sync(this);
            alternative = this.interpreter.adaptivePredict(this.tokenStream, 68, this.context);
            while (alternative !== 2 && alternative !== antlr.ATN.INVALID_ALT_NUMBER) {
                if (alternative === 1) {
                    {
                    {
                    this.state = 451;
                    this.errorHandler.sync(this);
                    _la = this.tokenStream.LA(1);
                    if (_la === 99) {
                        {
                        this.state = 450;
                        this.match(CypherParser.SP);
                        }
                    }

                    this.state = 453;
                    this.match(CypherParser.COMMA);
                    this.state = 455;
                    this.errorHandler.sync(this);
                    _la = this.tokenStream.LA(1);
                    if (_la === 99) {
                        {
                        this.state = 454;
                        this.match(CypherParser.SP);
                        }
                    }

                    this.state = 457;
                    this.removeItem();
                    }
                    }
                }
                this.state = 462;
                this.errorHandler.sync(this);
                alternative = this.interpreter.adaptivePredict(this.tokenStream, 68, this.context);
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
            this.state = 470;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 70, this.context) ) {
            case 1:
                this.enterOuterAlt(localContext, 1);
                {
                this.state = 463;
                this.symbol_();
                this.state = 465;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 464;
                    this.match(CypherParser.SP);
                    }
                }

                this.state = 467;
                this.nodeLabels();
                }
                break;
            case 2:
                this.enterOuterAlt(localContext, 2);
                {
                this.state = 469;
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
            this.state = 472;
            this.match(CypherParser.CALL);
            this.state = 474;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 473;
                this.match(CypherParser.SP);
                }
            }

            this.state = 476;
            this.invocationName();
            this.state = 478;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 477;
                this.match(CypherParser.SP);
                }
            }

            this.state = 480;
            this.parenExpressionChain();
            this.state = 489;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 75, this.context) ) {
            case 1:
                {
                this.state = 482;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 481;
                    this.match(CypherParser.SP);
                    }
                }

                this.state = 484;
                this.match(CypherParser.YIELD);
                this.state = 486;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 485;
                    this.match(CypherParser.SP);
                    }
                }

                this.state = 488;
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
            this.state = 491;
            this.match(CypherParser.LPAREN);
            this.state = 493;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 76, this.context) ) {
            case 1:
                {
                this.state = 492;
                this.match(CypherParser.SP);
                }
                break;
            }
            this.state = 496;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 77, this.context) ) {
            case 1:
                {
                this.state = 495;
                this.expressionChain();
                }
                break;
            }
            this.state = 499;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 498;
                this.match(CypherParser.SP);
                }
            }

            this.state = 501;
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
            this.state = 503;
            this.yieldItem();
            this.state = 514;
            this.errorHandler.sync(this);
            alternative = this.interpreter.adaptivePredict(this.tokenStream, 81, this.context);
            while (alternative !== 2 && alternative !== antlr.ATN.INVALID_ALT_NUMBER) {
                if (alternative === 1) {
                    {
                    {
                    this.state = 505;
                    this.errorHandler.sync(this);
                    _la = this.tokenStream.LA(1);
                    if (_la === 99) {
                        {
                        this.state = 504;
                        this.match(CypherParser.SP);
                        }
                    }

                    this.state = 507;
                    this.match(CypherParser.COMMA);
                    this.state = 509;
                    this.errorHandler.sync(this);
                    _la = this.tokenStream.LA(1);
                    if (_la === 99) {
                        {
                        this.state = 508;
                        this.match(CypherParser.SP);
                        }
                    }

                    this.state = 511;
                    this.yieldItem();
                    }
                    }
                }
                this.state = 516;
                this.errorHandler.sync(this);
                alternative = this.interpreter.adaptivePredict(this.tokenStream, 81, this.context);
            }
            this.state = 521;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 83, this.context) ) {
            case 1:
                {
                this.state = 518;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 517;
                    this.match(CypherParser.SP);
                    }
                }

                this.state = 520;
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
            this.state = 531;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 86, this.context) ) {
            case 1:
                {
                this.state = 523;
                this.symbol_();
                this.state = 525;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 524;
                    this.match(CypherParser.SP);
                    }
                }

                this.state = 527;
                this.match(CypherParser.AS);
                this.state = 529;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 528;
                    this.match(CypherParser.SP);
                    }
                }

                }
                break;
            }
            this.state = 533;
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
            this.state = 535;
            this.match(CypherParser.MERGE);
            this.state = 537;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 536;
                this.match(CypherParser.SP);
                }
            }

            this.state = 539;
            this.patternPart();
            this.state = 546;
            this.errorHandler.sync(this);
            alternative = this.interpreter.adaptivePredict(this.tokenStream, 89, this.context);
            while (alternative !== 2 && alternative !== antlr.ATN.INVALID_ALT_NUMBER) {
                if (alternative === 1) {
                    {
                    {
                    this.state = 541;
                    this.errorHandler.sync(this);
                    _la = this.tokenStream.LA(1);
                    if (_la === 99) {
                        {
                        this.state = 540;
                        this.match(CypherParser.SP);
                        }
                    }

                    this.state = 543;
                    this.mergeAction();
                    }
                    }
                }
                this.state = 548;
                this.errorHandler.sync(this);
                alternative = this.interpreter.adaptivePredict(this.tokenStream, 89, this.context);
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
            this.state = 549;
            this.match(CypherParser.ON);
            this.state = 551;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 550;
                this.match(CypherParser.SP);
                }
            }

            this.state = 553;
            _la = this.tokenStream.LA(1);
            if(!(_la === 40 || _la === 47)) {
            this.errorHandler.recoverInline(this);
            }
            else {
                this.errorHandler.reportMatch(this);
                this.consume();
            }
            this.state = 555;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 554;
                this.match(CypherParser.SP);
                }
            }

            this.state = 557;
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
            this.state = 559;
            this.match(CypherParser.SET);
            this.state = 561;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 560;
                this.match(CypherParser.SP);
                }
            }

            this.state = 563;
            this.setItem();
            this.state = 574;
            this.errorHandler.sync(this);
            alternative = this.interpreter.adaptivePredict(this.tokenStream, 95, this.context);
            while (alternative !== 2 && alternative !== antlr.ATN.INVALID_ALT_NUMBER) {
                if (alternative === 1) {
                    {
                    {
                    this.state = 565;
                    this.errorHandler.sync(this);
                    _la = this.tokenStream.LA(1);
                    if (_la === 99) {
                        {
                        this.state = 564;
                        this.match(CypherParser.SP);
                        }
                    }

                    this.state = 567;
                    this.match(CypherParser.COMMA);
                    this.state = 569;
                    this.errorHandler.sync(this);
                    _la = this.tokenStream.LA(1);
                    if (_la === 99) {
                        {
                        this.state = 568;
                        this.match(CypherParser.SP);
                        }
                    }

                    this.state = 571;
                    this.setItem();
                    }
                    }
                }
                this.state = 576;
                this.errorHandler.sync(this);
                alternative = this.interpreter.adaptivePredict(this.tokenStream, 95, this.context);
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
            this.state = 603;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 101, this.context) ) {
            case 1:
                this.enterOuterAlt(localContext, 1);
                {
                this.state = 577;
                this.propertyExpression();
                this.state = 579;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 578;
                    this.match(CypherParser.SP);
                    }
                }

                this.state = 581;
                this.match(CypherParser.ASSIGN);
                this.state = 583;
                this.errorHandler.sync(this);
                switch (this.interpreter.adaptivePredict(this.tokenStream, 97, this.context) ) {
                case 1:
                    {
                    this.state = 582;
                    this.match(CypherParser.SP);
                    }
                    break;
                }
                this.state = 585;
                this.expression();
                }
                break;
            case 2:
                this.enterOuterAlt(localContext, 2);
                {
                this.state = 587;
                this.symbol_();
                this.state = 589;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 588;
                    this.match(CypherParser.SP);
                    }
                }

                this.state = 591;
                _la = this.tokenStream.LA(1);
                if(!(_la === 1 || _la === 2)) {
                this.errorHandler.recoverInline(this);
                }
                else {
                    this.errorHandler.reportMatch(this);
                    this.consume();
                }
                this.state = 593;
                this.errorHandler.sync(this);
                switch (this.interpreter.adaptivePredict(this.tokenStream, 99, this.context) ) {
                case 1:
                    {
                    this.state = 592;
                    this.match(CypherParser.SP);
                    }
                    break;
                }
                this.state = 595;
                this.expression();
                }
                break;
            case 3:
                this.enterOuterAlt(localContext, 3);
                {
                this.state = 597;
                this.symbol_();
                this.state = 599;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 598;
                    this.match(CypherParser.SP);
                    }
                }

                this.state = 601;
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
            this.state = 610;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            do {
                {
                {
                this.state = 605;
                this.match(CypherParser.COLON);
                this.state = 607;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 606;
                    this.match(CypherParser.SP);
                    }
                }

                this.state = 609;
                this.name();
                }
                }
                this.state = 612;
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
            this.state = 614;
            this.match(CypherParser.CREATE);
            this.state = 616;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 615;
                this.match(CypherParser.SP);
                }
            }

            this.state = 618;
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
            this.state = 620;
            this.pattern();
            this.state = 625;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 106, this.context) ) {
            case 1:
                {
                this.state = 622;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 621;
                    this.match(CypherParser.SP);
                    }
                }

                this.state = 624;
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
            this.state = 627;
            this.match(CypherParser.WHERE);
            this.state = 629;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 107, this.context) ) {
            case 1:
                {
                this.state = 628;
                this.match(CypherParser.SP);
                }
                break;
            }
            this.state = 631;
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
            this.state = 633;
            this.patternPart();
            this.state = 644;
            this.errorHandler.sync(this);
            alternative = this.interpreter.adaptivePredict(this.tokenStream, 110, this.context);
            while (alternative !== 2 && alternative !== antlr.ATN.INVALID_ALT_NUMBER) {
                if (alternative === 1) {
                    {
                    {
                    this.state = 635;
                    this.errorHandler.sync(this);
                    _la = this.tokenStream.LA(1);
                    if (_la === 99) {
                        {
                        this.state = 634;
                        this.match(CypherParser.SP);
                        }
                    }

                    this.state = 637;
                    this.match(CypherParser.COMMA);
                    this.state = 639;
                    this.errorHandler.sync(this);
                    _la = this.tokenStream.LA(1);
                    if (_la === 99) {
                        {
                        this.state = 638;
                        this.match(CypherParser.SP);
                        }
                    }

                    this.state = 641;
                    this.patternPart();
                    }
                    }
                }
                this.state = 646;
                this.errorHandler.sync(this);
                alternative = this.interpreter.adaptivePredict(this.tokenStream, 110, this.context);
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
            this.state = 647;
            this.xorExpression();
            this.state = 658;
            this.errorHandler.sync(this);
            alternative = this.interpreter.adaptivePredict(this.tokenStream, 113, this.context);
            while (alternative !== 2 && alternative !== antlr.ATN.INVALID_ALT_NUMBER) {
                if (alternative === 1) {
                    {
                    {
                    this.state = 649;
                    this.errorHandler.sync(this);
                    _la = this.tokenStream.LA(1);
                    if (_la === 99) {
                        {
                        this.state = 648;
                        this.match(CypherParser.SP);
                        }
                    }

                    this.state = 651;
                    this.match(CypherParser.OR);
                    this.state = 653;
                    this.errorHandler.sync(this);
                    switch (this.interpreter.adaptivePredict(this.tokenStream, 112, this.context) ) {
                    case 1:
                        {
                        this.state = 652;
                        this.match(CypherParser.SP);
                        }
                        break;
                    }
                    this.state = 655;
                    this.xorExpression();
                    }
                    }
                }
                this.state = 660;
                this.errorHandler.sync(this);
                alternative = this.interpreter.adaptivePredict(this.tokenStream, 113, this.context);
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
            this.state = 661;
            this.andExpression();
            this.state = 672;
            this.errorHandler.sync(this);
            alternative = this.interpreter.adaptivePredict(this.tokenStream, 116, this.context);
            while (alternative !== 2 && alternative !== antlr.ATN.INVALID_ALT_NUMBER) {
                if (alternative === 1) {
                    {
                    {
                    this.state = 663;
                    this.errorHandler.sync(this);
                    _la = this.tokenStream.LA(1);
                    if (_la === 99) {
                        {
                        this.state = 662;
                        this.match(CypherParser.SP);
                        }
                    }

                    this.state = 665;
                    this.match(CypherParser.XOR);
                    this.state = 667;
                    this.errorHandler.sync(this);
                    switch (this.interpreter.adaptivePredict(this.tokenStream, 115, this.context) ) {
                    case 1:
                        {
                        this.state = 666;
                        this.match(CypherParser.SP);
                        }
                        break;
                    }
                    this.state = 669;
                    this.andExpression();
                    }
                    }
                }
                this.state = 674;
                this.errorHandler.sync(this);
                alternative = this.interpreter.adaptivePredict(this.tokenStream, 116, this.context);
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
            this.state = 675;
            this.notExpression();
            this.state = 686;
            this.errorHandler.sync(this);
            alternative = this.interpreter.adaptivePredict(this.tokenStream, 119, this.context);
            while (alternative !== 2 && alternative !== antlr.ATN.INVALID_ALT_NUMBER) {
                if (alternative === 1) {
                    {
                    {
                    this.state = 677;
                    this.errorHandler.sync(this);
                    _la = this.tokenStream.LA(1);
                    if (_la === 99) {
                        {
                        this.state = 676;
                        this.match(CypherParser.SP);
                        }
                    }

                    this.state = 679;
                    this.match(CypherParser.AND);
                    this.state = 681;
                    this.errorHandler.sync(this);
                    switch (this.interpreter.adaptivePredict(this.tokenStream, 118, this.context) ) {
                    case 1:
                        {
                        this.state = 680;
                        this.match(CypherParser.SP);
                        }
                        break;
                    }
                    this.state = 683;
                    this.notExpression();
                    }
                    }
                }
                this.state = 688;
                this.errorHandler.sync(this);
                alternative = this.interpreter.adaptivePredict(this.tokenStream, 119, this.context);
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
            this.state = 695;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            while (_la === 67) {
                {
                {
                this.state = 689;
                this.match(CypherParser.NOT);
                this.state = 691;
                this.errorHandler.sync(this);
                switch (this.interpreter.adaptivePredict(this.tokenStream, 120, this.context) ) {
                case 1:
                    {
                    this.state = 690;
                    this.match(CypherParser.SP);
                    }
                    break;
                }
                }
                }
                this.state = 697;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
            }
            this.state = 698;
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
            this.state = 700;
            this.addSubExpression();
            this.state = 712;
            this.errorHandler.sync(this);
            alternative = this.interpreter.adaptivePredict(this.tokenStream, 124, this.context);
            while (alternative !== 2 && alternative !== antlr.ATN.INVALID_ALT_NUMBER) {
                if (alternative === 1) {
                    {
                    {
                    this.state = 702;
                    this.errorHandler.sync(this);
                    _la = this.tokenStream.LA(1);
                    if (_la === 99) {
                        {
                        this.state = 701;
                        this.match(CypherParser.SP);
                        }
                    }

                    this.state = 704;
                    this.comparisonSigns();
                    this.state = 706;
                    this.errorHandler.sync(this);
                    switch (this.interpreter.adaptivePredict(this.tokenStream, 123, this.context) ) {
                    case 1:
                        {
                        this.state = 705;
                        this.match(CypherParser.SP);
                        }
                        break;
                    }
                    this.state = 708;
                    this.addSubExpression();
                    }
                    }
                }
                this.state = 714;
                this.errorHandler.sync(this);
                alternative = this.interpreter.adaptivePredict(this.tokenStream, 124, this.context);
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
            this.state = 715;
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
            this.state = 717;
            this.multDivExpression();
            this.state = 728;
            this.errorHandler.sync(this);
            alternative = this.interpreter.adaptivePredict(this.tokenStream, 127, this.context);
            while (alternative !== 2 && alternative !== antlr.ATN.INVALID_ALT_NUMBER) {
                if (alternative === 1) {
                    {
                    {
                    this.state = 719;
                    this.errorHandler.sync(this);
                    _la = this.tokenStream.LA(1);
                    if (_la === 99) {
                        {
                        this.state = 718;
                        this.match(CypherParser.SP);
                        }
                    }

                    this.state = 721;
                    _la = this.tokenStream.LA(1);
                    if(!(_la === 18 || _la === 19)) {
                    this.errorHandler.recoverInline(this);
                    }
                    else {
                        this.errorHandler.reportMatch(this);
                        this.consume();
                    }
                    this.state = 723;
                    this.errorHandler.sync(this);
                    switch (this.interpreter.adaptivePredict(this.tokenStream, 126, this.context) ) {
                    case 1:
                        {
                        this.state = 722;
                        this.match(CypherParser.SP);
                        }
                        break;
                    }
                    this.state = 725;
                    this.multDivExpression();
                    }
                    }
                }
                this.state = 730;
                this.errorHandler.sync(this);
                alternative = this.interpreter.adaptivePredict(this.tokenStream, 127, this.context);
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
            this.state = 731;
            this.powerExpression();
            this.state = 742;
            this.errorHandler.sync(this);
            alternative = this.interpreter.adaptivePredict(this.tokenStream, 130, this.context);
            while (alternative !== 2 && alternative !== antlr.ATN.INVALID_ALT_NUMBER) {
                if (alternative === 1) {
                    {
                    {
                    this.state = 733;
                    this.errorHandler.sync(this);
                    _la = this.tokenStream.LA(1);
                    if (_la === 99) {
                        {
                        this.state = 732;
                        this.match(CypherParser.SP);
                        }
                    }

                    this.state = 735;
                    _la = this.tokenStream.LA(1);
                    if(!((((_la) & ~0x1F) === 0 && ((1 << _la) & 11534336) !== 0))) {
                    this.errorHandler.recoverInline(this);
                    }
                    else {
                        this.errorHandler.reportMatch(this);
                        this.consume();
                    }
                    this.state = 737;
                    this.errorHandler.sync(this);
                    switch (this.interpreter.adaptivePredict(this.tokenStream, 129, this.context) ) {
                    case 1:
                        {
                        this.state = 736;
                        this.match(CypherParser.SP);
                        }
                        break;
                    }
                    this.state = 739;
                    this.powerExpression();
                    }
                    }
                }
                this.state = 744;
                this.errorHandler.sync(this);
                alternative = this.interpreter.adaptivePredict(this.tokenStream, 130, this.context);
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
            this.state = 745;
            this.unaryAddSubExpression();
            this.state = 756;
            this.errorHandler.sync(this);
            alternative = this.interpreter.adaptivePredict(this.tokenStream, 133, this.context);
            while (alternative !== 2 && alternative !== antlr.ATN.INVALID_ALT_NUMBER) {
                if (alternative === 1) {
                    {
                    {
                    this.state = 747;
                    this.errorHandler.sync(this);
                    _la = this.tokenStream.LA(1);
                    if (_la === 99) {
                        {
                        this.state = 746;
                        this.match(CypherParser.SP);
                        }
                    }

                    this.state = 749;
                    this.match(CypherParser.CARET);
                    this.state = 751;
                    this.errorHandler.sync(this);
                    switch (this.interpreter.adaptivePredict(this.tokenStream, 132, this.context) ) {
                    case 1:
                        {
                        this.state = 750;
                        this.match(CypherParser.SP);
                        }
                        break;
                    }
                    this.state = 753;
                    this.unaryAddSubExpression();
                    }
                    }
                }
                this.state = 758;
                this.errorHandler.sync(this);
                alternative = this.interpreter.adaptivePredict(this.tokenStream, 133, this.context);
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
            this.state = 760;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 18 || _la === 19) {
                {
                this.state = 759;
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

            this.state = 763;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 762;
                this.match(CypherParser.SP);
                }
            }

            this.state = 765;
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
            this.state = 767;
            this.propertyOrLabelExpression();
            this.state = 778;
            this.errorHandler.sync(this);
            alternative = this.interpreter.adaptivePredict(this.tokenStream, 138, this.context);
            while (alternative !== 2 && alternative !== antlr.ATN.INVALID_ALT_NUMBER) {
                if (alternative === 1) {
                    {
                    {
                    this.state = 769;
                    this.errorHandler.sync(this);
                    switch (this.interpreter.adaptivePredict(this.tokenStream, 136, this.context) ) {
                    case 1:
                        {
                        this.state = 768;
                        this.match(CypherParser.SP);
                        }
                        break;
                    }
                    this.state = 774;
                    this.errorHandler.sync(this);
                    switch (this.interpreter.adaptivePredict(this.tokenStream, 137, this.context) ) {
                    case 1:
                        {
                        this.state = 771;
                        this.stringExpression();
                        }
                        break;
                    case 2:
                        {
                        this.state = 772;
                        this.listExpression();
                        }
                        break;
                    case 3:
                        {
                        this.state = 773;
                        this.nullExpression();
                        }
                        break;
                    }
                    }
                    }
                }
                this.state = 780;
                this.errorHandler.sync(this);
                alternative = this.interpreter.adaptivePredict(this.tokenStream, 138, this.context);
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
            this.state = 813;
            this.errorHandler.sync(this);
            switch (this.tokenStream.LA(1)) {
            case CypherParser.IN:
            case CypherParser.SP:
                this.enterOuterAlt(localContext, 1);
                {
                this.state = 782;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 781;
                    this.match(CypherParser.SP);
                    }
                }

                this.state = 784;
                this.match(CypherParser.IN);
                this.state = 786;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 785;
                    this.match(CypherParser.SP);
                    }
                }

                this.state = 788;
                this.propertyOrLabelExpression();
                }
                break;
            case CypherParser.LBRACK:
                this.enterOuterAlt(localContext, 2);
                {
                this.state = 789;
                this.match(CypherParser.LBRACK);
                this.state = 791;
                this.errorHandler.sync(this);
                switch (this.interpreter.adaptivePredict(this.tokenStream, 141, this.context) ) {
                case 1:
                    {
                    this.state = 790;
                    this.match(CypherParser.SP);
                    }
                    break;
                }
                this.state = 807;
                this.errorHandler.sync(this);
                switch (this.interpreter.adaptivePredict(this.tokenStream, 146, this.context) ) {
                case 1:
                    {
                    this.state = 794;
                    this.errorHandler.sync(this);
                    switch (this.interpreter.adaptivePredict(this.tokenStream, 142, this.context) ) {
                    case 1:
                        {
                        this.state = 793;
                        this.expression();
                        }
                        break;
                    }
                    this.state = 797;
                    this.errorHandler.sync(this);
                    _la = this.tokenStream.LA(1);
                    if (_la === 99) {
                        {
                        this.state = 796;
                        this.match(CypherParser.SP);
                        }
                    }

                    this.state = 799;
                    this.match(CypherParser.RANGE);
                    this.state = 801;
                    this.errorHandler.sync(this);
                    switch (this.interpreter.adaptivePredict(this.tokenStream, 144, this.context) ) {
                    case 1:
                        {
                        this.state = 800;
                        this.match(CypherParser.SP);
                        }
                        break;
                    }
                    this.state = 804;
                    this.errorHandler.sync(this);
                    switch (this.interpreter.adaptivePredict(this.tokenStream, 145, this.context) ) {
                    case 1:
                        {
                        this.state = 803;
                        this.expression();
                        }
                        break;
                    }
                    }
                    break;
                case 2:
                    {
                    this.state = 806;
                    this.expression();
                    }
                    break;
                }
                this.state = 810;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 809;
                    this.match(CypherParser.SP);
                    }
                }

                this.state = 812;
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
            this.state = 815;
            this.stringExpPrefix();
            this.state = 817;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 816;
                this.match(CypherParser.SP);
                }
            }

            this.state = 819;
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
            this.state = 832;
            this.errorHandler.sync(this);
            switch (this.tokenStream.LA(1)) {
            case CypherParser.STARTS:
                this.enterOuterAlt(localContext, 1);
                {
                this.state = 821;
                this.match(CypherParser.STARTS);
                this.state = 823;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 822;
                    this.match(CypherParser.SP);
                    }
                }

                this.state = 825;
                this.match(CypherParser.WITH);
                }
                break;
            case CypherParser.ENDS:
                this.enterOuterAlt(localContext, 2);
                {
                this.state = 826;
                this.match(CypherParser.ENDS);
                this.state = 828;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 827;
                    this.match(CypherParser.SP);
                    }
                }

                this.state = 830;
                this.match(CypherParser.WITH);
                }
                break;
            case CypherParser.CONTAINS:
                this.enterOuterAlt(localContext, 3);
                {
                this.state = 831;
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
            this.state = 835;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 834;
                this.match(CypherParser.SP);
                }
            }

            this.state = 837;
            this.match(CypherParser.IS);
            this.state = 839;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 154, this.context) ) {
            case 1:
                {
                this.state = 838;
                this.match(CypherParser.SP);
                }
                break;
            }
            this.state = 842;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 67) {
                {
                this.state = 841;
                this.match(CypherParser.NOT);
                }
            }

            this.state = 845;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 844;
                this.match(CypherParser.SP);
                }
            }

            this.state = 847;
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
            this.state = 849;
            this.propertyExpression();
            this.state = 854;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 158, this.context) ) {
            case 1:
                {
                this.state = 851;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 850;
                    this.match(CypherParser.SP);
                    }
                }

                this.state = 853;
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
            this.state = 856;
            this.atom();
            this.state = 867;
            this.errorHandler.sync(this);
            alternative = this.interpreter.adaptivePredict(this.tokenStream, 161, this.context);
            while (alternative !== 2 && alternative !== antlr.ATN.INVALID_ALT_NUMBER) {
                if (alternative === 1) {
                    {
                    {
                    this.state = 858;
                    this.errorHandler.sync(this);
                    _la = this.tokenStream.LA(1);
                    if (_la === 99) {
                        {
                        this.state = 857;
                        this.match(CypherParser.SP);
                        }
                    }

                    this.state = 860;
                    this.match(CypherParser.DOT);
                    this.state = 862;
                    this.errorHandler.sync(this);
                    _la = this.tokenStream.LA(1);
                    if (_la === 99) {
                        {
                        this.state = 861;
                        this.match(CypherParser.SP);
                        }
                    }

                    this.state = 864;
                    this.name();
                    }
                    }
                }
                this.state = 869;
                this.errorHandler.sync(this);
                alternative = this.interpreter.adaptivePredict(this.tokenStream, 161, this.context);
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
            this.state = 878;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 164, this.context) ) {
            case 1:
                {
                this.state = 870;
                this.symbol_();
                this.state = 872;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 871;
                    this.match(CypherParser.SP);
                    }
                }

                this.state = 874;
                this.match(CypherParser.ASSIGN);
                this.state = 876;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 875;
                    this.match(CypherParser.SP);
                    }
                }

                }
                break;
            }
            this.state = 880;
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
            this.state = 903;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 169, this.context) ) {
            case 1:
                this.enterOuterAlt(localContext, 1);
                {
                this.state = 882;
                this.nodePattern();
                this.state = 889;
                this.errorHandler.sync(this);
                alternative = this.interpreter.adaptivePredict(this.tokenStream, 166, this.context);
                while (alternative !== 2 && alternative !== antlr.ATN.INVALID_ALT_NUMBER) {
                    if (alternative === 1) {
                        {
                        {
                        this.state = 884;
                        this.errorHandler.sync(this);
                        _la = this.tokenStream.LA(1);
                        if (_la === 99) {
                            {
                            this.state = 883;
                            this.match(CypherParser.SP);
                            }
                        }

                        this.state = 886;
                        this.patternElemChain();
                        }
                        }
                    }
                    this.state = 891;
                    this.errorHandler.sync(this);
                    alternative = this.interpreter.adaptivePredict(this.tokenStream, 166, this.context);
                }
                }
                break;
            case 2:
                this.enterOuterAlt(localContext, 2);
                {
                this.state = 892;
                this.match(CypherParser.LPAREN);
                this.state = 894;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 893;
                    this.match(CypherParser.SP);
                    }
                }

                this.state = 896;
                this.patternElem();
                this.state = 898;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 897;
                    this.match(CypherParser.SP);
                    }
                }

                this.state = 900;
                this.match(CypherParser.RPAREN);
                }
                break;
            case 3:
                this.enterOuterAlt(localContext, 3);
                {
                this.state = 902;
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
            this.state = 905;
            this.relationshipPattern();
            this.state = 907;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 906;
                this.match(CypherParser.SP);
                }
            }

            this.state = 909;
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
            this.state = 913;
            this.errorHandler.sync(this);
            switch (this.tokenStream.LA(1)) {
            case CypherParser.LBRACE:
                this.enterOuterAlt(localContext, 1);
                {
                this.state = 911;
                this.mapLit();
                }
                break;
            case CypherParser.DOLLAR:
                this.enterOuterAlt(localContext, 2);
                {
                this.state = 912;
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
            this.state = 915;
            this.match(CypherParser.LPAREN);
            this.state = 917;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 172, this.context) ) {
            case 1:
                {
                this.state = 916;
                this.match(CypherParser.SP);
                }
                break;
            }
            this.state = 920;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (((((_la - 30)) & ~0x1F) === 0 && ((1 << (_la - 30)) & 63) !== 0) || ((((_la - 89)) & ~0x1F) === 0 && ((1 << (_la - 89)) & 89) !== 0)) {
                {
                this.state = 919;
                this.symbol_();
                }
            }

            this.state = 923;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 174, this.context) ) {
            case 1:
                {
                this.state = 922;
                this.match(CypherParser.SP);
                }
                break;
            }
            this.state = 926;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 25) {
                {
                this.state = 925;
                this.nodeLabels();
                }
            }

            this.state = 929;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 176, this.context) ) {
            case 1:
                {
                this.state = 928;
                this.match(CypherParser.SP);
                }
                break;
            }
            this.state = 932;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 14 || _la === 27) {
                {
                this.state = 931;
                this.properties();
                }
            }

            this.state = 935;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 934;
                this.match(CypherParser.SP);
                }
            }

            this.state = 937;
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
            this.state = 951;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 179, this.context) ) {
            case 1:
                this.enterOuterAlt(localContext, 1);
                {
                this.state = 939;
                this.literal();
                }
                break;
            case 2:
                this.enterOuterAlt(localContext, 2);
                {
                this.state = 940;
                this.parameter();
                }
                break;
            case 3:
                this.enterOuterAlt(localContext, 3);
                {
                this.state = 941;
                this.caseExpression();
                }
                break;
            case 4:
                this.enterOuterAlt(localContext, 4);
                {
                this.state = 942;
                this.countAll();
                }
                break;
            case 5:
                this.enterOuterAlt(localContext, 5);
                {
                this.state = 943;
                this.listComprehension();
                }
                break;
            case 6:
                this.enterOuterAlt(localContext, 6);
                {
                this.state = 944;
                this.patternComprehension();
                }
                break;
            case 7:
                this.enterOuterAlt(localContext, 7);
                {
                this.state = 945;
                this.filterWith();
                }
                break;
            case 8:
                this.enterOuterAlt(localContext, 8);
                {
                this.state = 946;
                this.relationshipsChainPattern();
                }
                break;
            case 9:
                this.enterOuterAlt(localContext, 9);
                {
                this.state = 947;
                this.parenthesizedExpression();
                }
                break;
            case 10:
                this.enterOuterAlt(localContext, 10);
                {
                this.state = 948;
                this.functionInvocation();
                }
                break;
            case 11:
                this.enterOuterAlt(localContext, 11);
                {
                this.state = 949;
                this.symbol_();
                }
                break;
            case 12:
                this.enterOuterAlt(localContext, 12);
                {
                this.state = 950;
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
            this.state = 953;
            this.symbol_();
            this.state = 954;
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
            this.state = 994;
            this.errorHandler.sync(this);
            switch (this.tokenStream.LA(1)) {
            case CypherParser.LT:
                this.enterOuterAlt(localContext, 1);
                {
                this.state = 956;
                this.match(CypherParser.LT);
                this.state = 958;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 957;
                    this.match(CypherParser.SP);
                    }
                }

                this.state = 960;
                this.match(CypherParser.SUB);
                this.state = 962;
                this.errorHandler.sync(this);
                switch (this.interpreter.adaptivePredict(this.tokenStream, 181, this.context) ) {
                case 1:
                    {
                    this.state = 961;
                    this.match(CypherParser.SP);
                    }
                    break;
                }
                this.state = 965;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 16) {
                    {
                    this.state = 964;
                    this.relationDetail();
                    }
                }

                this.state = 968;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 967;
                    this.match(CypherParser.SP);
                    }
                }

                this.state = 970;
                this.match(CypherParser.SUB);
                this.state = 972;
                this.errorHandler.sync(this);
                switch (this.interpreter.adaptivePredict(this.tokenStream, 184, this.context) ) {
                case 1:
                    {
                    this.state = 971;
                    this.match(CypherParser.SP);
                    }
                    break;
                }
                this.state = 975;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 5) {
                    {
                    this.state = 974;
                    this.match(CypherParser.GT);
                    }
                }

                }
                break;
            case CypherParser.SUB:
                this.enterOuterAlt(localContext, 2);
                {
                this.state = 977;
                this.match(CypherParser.SUB);
                this.state = 979;
                this.errorHandler.sync(this);
                switch (this.interpreter.adaptivePredict(this.tokenStream, 186, this.context) ) {
                case 1:
                    {
                    this.state = 978;
                    this.match(CypherParser.SP);
                    }
                    break;
                }
                this.state = 982;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 16) {
                    {
                    this.state = 981;
                    this.relationDetail();
                    }
                }

                this.state = 985;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 984;
                    this.match(CypherParser.SP);
                    }
                }

                this.state = 987;
                this.match(CypherParser.SUB);
                this.state = 989;
                this.errorHandler.sync(this);
                switch (this.interpreter.adaptivePredict(this.tokenStream, 189, this.context) ) {
                case 1:
                    {
                    this.state = 988;
                    this.match(CypherParser.SP);
                    }
                    break;
                }
                this.state = 992;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 5) {
                    {
                    this.state = 991;
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
            this.state = 996;
            this.match(CypherParser.LBRACK);
            this.state = 998;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 192, this.context) ) {
            case 1:
                {
                this.state = 997;
                this.match(CypherParser.SP);
                }
                break;
            }
            this.state = 1001;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (((((_la - 30)) & ~0x1F) === 0 && ((1 << (_la - 30)) & 63) !== 0) || ((((_la - 89)) & ~0x1F) === 0 && ((1 << (_la - 89)) & 89) !== 0)) {
                {
                this.state = 1000;
                this.symbol_();
                }
            }

            this.state = 1004;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 194, this.context) ) {
            case 1:
                {
                this.state = 1003;
                this.match(CypherParser.SP);
                }
                break;
            }
            this.state = 1007;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 25) {
                {
                this.state = 1006;
                this.relationshipTypes();
                }
            }

            this.state = 1010;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 196, this.context) ) {
            case 1:
                {
                this.state = 1009;
                this.match(CypherParser.SP);
                }
                break;
            }
            this.state = 1013;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 23) {
                {
                this.state = 1012;
                this.rangeLit();
                }
            }

            this.state = 1016;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 198, this.context) ) {
            case 1:
                {
                this.state = 1015;
                this.match(CypherParser.SP);
                }
                break;
            }
            this.state = 1019;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 14 || _la === 27) {
                {
                this.state = 1018;
                this.properties();
                }
            }

            this.state = 1022;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 1021;
                this.match(CypherParser.SP);
                }
            }

            this.state = 1024;
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
            this.state = 1026;
            this.match(CypherParser.MULT);
            this.state = 1028;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 201, this.context) ) {
            case 1:
                {
                this.state = 1027;
                this.match(CypherParser.SP);
                }
                break;
            }
            this.state = 1031;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 92) {
                {
                this.state = 1030;
                this.match(CypherParser.Integer);
                }
            }

            this.state = 1043;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 206, this.context) ) {
            case 1:
                {
                this.state = 1034;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 1033;
                    this.match(CypherParser.SP);
                    }
                }

                this.state = 1036;
                this.match(CypherParser.RANGE);
                this.state = 1038;
                this.errorHandler.sync(this);
                switch (this.interpreter.adaptivePredict(this.tokenStream, 204, this.context) ) {
                case 1:
                    {
                    this.state = 1037;
                    this.match(CypherParser.SP);
                    }
                    break;
                }
                this.state = 1041;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 92) {
                    {
                    this.state = 1040;
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
            this.state = 1045;
            this.match(CypherParser.COLON);
            this.state = 1047;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 1046;
                this.match(CypherParser.SP);
                }
            }

            this.state = 1049;
            this.name();
            this.state = 1066;
            this.errorHandler.sync(this);
            alternative = this.interpreter.adaptivePredict(this.tokenStream, 212, this.context);
            while (alternative !== 2 && alternative !== antlr.ATN.INVALID_ALT_NUMBER) {
                if (alternative === 1) {
                    {
                    {
                    this.state = 1051;
                    this.errorHandler.sync(this);
                    _la = this.tokenStream.LA(1);
                    if (_la === 99) {
                        {
                        this.state = 1050;
                        this.match(CypherParser.SP);
                        }
                    }

                    this.state = 1053;
                    this.match(CypherParser.STICK);
                    this.state = 1055;
                    this.errorHandler.sync(this);
                    switch (this.interpreter.adaptivePredict(this.tokenStream, 209, this.context) ) {
                    case 1:
                        {
                        this.state = 1054;
                        this.match(CypherParser.SP);
                        }
                        break;
                    }
                    this.state = 1058;
                    this.errorHandler.sync(this);
                    _la = this.tokenStream.LA(1);
                    if (_la === 25) {
                        {
                        this.state = 1057;
                        this.match(CypherParser.COLON);
                        }
                    }

                    this.state = 1061;
                    this.errorHandler.sync(this);
                    _la = this.tokenStream.LA(1);
                    if (_la === 99) {
                        {
                        this.state = 1060;
                        this.match(CypherParser.SP);
                        }
                    }

                    this.state = 1063;
                    this.name();
                    }
                    }
                }
                this.state = 1068;
                this.errorHandler.sync(this);
                alternative = this.interpreter.adaptivePredict(this.tokenStream, 212, this.context);
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
            this.state = 1069;
            this.match(CypherParser.UNION);
            this.state = 1071;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 213, this.context) ) {
            case 1:
                {
                this.state = 1070;
                this.match(CypherParser.SP);
                }
                break;
            }
            this.state = 1074;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 36) {
                {
                this.state = 1073;
                this.match(CypherParser.ALL);
                }
            }

            this.state = 1077;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 1076;
                this.match(CypherParser.SP);
                }
            }

            this.state = 1079;
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
            this.state = 1081;
            this.match(CypherParser.EXISTS);
            this.state = 1083;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 1082;
                this.match(CypherParser.SP);
                }
            }

            this.state = 1085;
            this.match(CypherParser.LBRACE);
            this.state = 1087;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 1086;
                this.match(CypherParser.SP);
                }
            }

            this.state = 1091;
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
                this.state = 1089;
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
                this.state = 1090;
                this.patternWhere();
                }
                break;
            default:
                throw new antlr.NoViableAltException(this);
            }
            this.state = 1094;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 1093;
                this.match(CypherParser.SP);
                }
            }

            this.state = 1096;
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
            this.state = 1098;
            this.symbol_();
            this.state = 1109;
            this.errorHandler.sync(this);
            alternative = this.interpreter.adaptivePredict(this.tokenStream, 222, this.context);
            while (alternative !== 2 && alternative !== antlr.ATN.INVALID_ALT_NUMBER) {
                if (alternative === 1) {
                    {
                    {
                    this.state = 1100;
                    this.errorHandler.sync(this);
                    _la = this.tokenStream.LA(1);
                    if (_la === 99) {
                        {
                        this.state = 1099;
                        this.match(CypherParser.SP);
                        }
                    }

                    this.state = 1102;
                    this.match(CypherParser.DOT);
                    this.state = 1104;
                    this.errorHandler.sync(this);
                    _la = this.tokenStream.LA(1);
                    if (_la === 99) {
                        {
                        this.state = 1103;
                        this.match(CypherParser.SP);
                        }
                    }

                    this.state = 1106;
                    this.symbol_();
                    }
                    }
                }
                this.state = 1111;
                this.errorHandler.sync(this);
                alternative = this.interpreter.adaptivePredict(this.tokenStream, 222, this.context);
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
            this.state = 1154;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 234, this.context) ) {
            case 1:
                this.enterOuterAlt(localContext, 1);
                {
                this.state = 1112;
                this.invocationName();
                this.state = 1114;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 1113;
                    this.match(CypherParser.SP);
                    }
                }

                this.state = 1116;
                this.match(CypherParser.LPAREN);
                this.state = 1118;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 1117;
                    this.match(CypherParser.SP);
                    }
                }

                this.state = 1124;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 63) {
                    {
                    this.state = 1120;
                    this.match(CypherParser.DISTINCT);
                    this.state = 1122;
                    this.errorHandler.sync(this);
                    _la = this.tokenStream.LA(1);
                    if (_la === 99) {
                        {
                        this.state = 1121;
                        this.match(CypherParser.SP);
                        }
                    }

                    }
                }

                this.state = 1126;
                this.patternElem();
                this.state = 1128;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 1127;
                    this.match(CypherParser.SP);
                    }
                }

                this.state = 1130;
                this.match(CypherParser.RPAREN);
                }
                break;
            case 2:
                this.enterOuterAlt(localContext, 2);
                {
                this.state = 1132;
                this.invocationName();
                this.state = 1134;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 1133;
                    this.match(CypherParser.SP);
                    }
                }

                this.state = 1136;
                this.match(CypherParser.LPAREN);
                this.state = 1138;
                this.errorHandler.sync(this);
                switch (this.interpreter.adaptivePredict(this.tokenStream, 229, this.context) ) {
                case 1:
                    {
                    this.state = 1137;
                    this.match(CypherParser.SP);
                    }
                    break;
                }
                this.state = 1144;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 63) {
                    {
                    this.state = 1140;
                    this.match(CypherParser.DISTINCT);
                    this.state = 1142;
                    this.errorHandler.sync(this);
                    switch (this.interpreter.adaptivePredict(this.tokenStream, 230, this.context) ) {
                    case 1:
                        {
                        this.state = 1141;
                        this.match(CypherParser.SP);
                        }
                        break;
                    }
                    }
                }

                this.state = 1147;
                this.errorHandler.sync(this);
                switch (this.interpreter.adaptivePredict(this.tokenStream, 232, this.context) ) {
                case 1:
                    {
                    this.state = 1146;
                    this.expressionChain();
                    }
                    break;
                }
                this.state = 1150;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 1149;
                    this.match(CypherParser.SP);
                    }
                }

                this.state = 1152;
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
            this.state = 1156;
            this.match(CypherParser.LPAREN);
            this.state = 1158;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 235, this.context) ) {
            case 1:
                {
                this.state = 1157;
                this.match(CypherParser.SP);
                }
                break;
            }
            this.state = 1160;
            this.expression();
            this.state = 1162;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 1161;
                this.match(CypherParser.SP);
                }
            }

            this.state = 1164;
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
            this.state = 1166;
            _la = this.tokenStream.LA(1);
            if(!(((((_la - 33)) & ~0x1F) === 0 && ((1 << (_la - 33)) & 15) !== 0))) {
            this.errorHandler.recoverInline(this);
            }
            else {
                this.errorHandler.reportMatch(this);
                this.consume();
            }
            this.state = 1168;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 1167;
                this.match(CypherParser.SP);
                }
            }

            this.state = 1170;
            this.match(CypherParser.LPAREN);
            this.state = 1172;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 1171;
                this.match(CypherParser.SP);
                }
            }

            this.state = 1174;
            this.filterExpression();
            this.state = 1176;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 1175;
                this.match(CypherParser.SP);
                }
            }

            this.state = 1178;
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
            this.state = 1180;
            this.match(CypherParser.LBRACK);
            this.state = 1182;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 1181;
                this.match(CypherParser.SP);
                }
            }

            this.state = 1192;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (((((_la - 30)) & ~0x1F) === 0 && ((1 << (_la - 30)) & 63) !== 0) || ((((_la - 89)) & ~0x1F) === 0 && ((1 << (_la - 89)) & 89) !== 0)) {
                {
                this.state = 1184;
                this.lhs();
                this.state = 1186;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 1185;
                    this.match(CypherParser.SP);
                    }
                }

                this.state = 1188;
                this.match(CypherParser.ASSIGN);
                this.state = 1190;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 1189;
                    this.match(CypherParser.SP);
                    }
                }

                }
            }

            this.state = 1194;
            this.relationshipsChainPattern();
            this.state = 1199;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 245, this.context) ) {
            case 1:
                {
                this.state = 1196;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 1195;
                    this.match(CypherParser.SP);
                    }
                }

                this.state = 1198;
                this.where();
                }
                break;
            }
            this.state = 1202;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 1201;
                this.match(CypherParser.SP);
                }
            }

            this.state = 1204;
            this.match(CypherParser.STICK);
            this.state = 1206;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 247, this.context) ) {
            case 1:
                {
                this.state = 1205;
                this.match(CypherParser.SP);
                }
                break;
            }
            this.state = 1208;
            this.expression();
            this.state = 1210;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 1209;
                this.match(CypherParser.SP);
                }
            }

            this.state = 1212;
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
            this.state = 1214;
            this.nodePattern();
            this.state = 1219;
            this.errorHandler.sync(this);
            alternative = 1;
            do {
                switch (alternative) {
                case 1:
                    {
                    {
                    this.state = 1216;
                    this.errorHandler.sync(this);
                    _la = this.tokenStream.LA(1);
                    if (_la === 99) {
                        {
                        this.state = 1215;
                        this.match(CypherParser.SP);
                        }
                    }

                    this.state = 1218;
                    this.patternElemChain();
                    }
                    }
                    break;
                default:
                    throw new antlr.NoViableAltException(this);
                }
                this.state = 1221;
                this.errorHandler.sync(this);
                alternative = this.interpreter.adaptivePredict(this.tokenStream, 250, this.context);
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
            this.state = 1223;
            this.match(CypherParser.LBRACK);
            this.state = 1225;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 1224;
                this.match(CypherParser.SP);
                }
            }

            this.state = 1227;
            this.filterExpression();
            this.state = 1236;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 254, this.context) ) {
            case 1:
                {
                this.state = 1229;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 1228;
                    this.match(CypherParser.SP);
                    }
                }

                this.state = 1231;
                this.match(CypherParser.STICK);
                this.state = 1233;
                this.errorHandler.sync(this);
                switch (this.interpreter.adaptivePredict(this.tokenStream, 253, this.context) ) {
                case 1:
                    {
                    this.state = 1232;
                    this.match(CypherParser.SP);
                    }
                    break;
                }
                this.state = 1235;
                this.expression();
                }
                break;
            }
            this.state = 1239;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 1238;
                this.match(CypherParser.SP);
                }
            }

            this.state = 1241;
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
            this.state = 1243;
            this.symbol_();
            this.state = 1245;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 1244;
                this.match(CypherParser.SP);
                }
            }

            this.state = 1247;
            this.match(CypherParser.IN);
            this.state = 1249;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 257, this.context) ) {
            case 1:
                {
                this.state = 1248;
                this.match(CypherParser.SP);
                }
                break;
            }
            this.state = 1251;
            this.expression();
            this.state = 1256;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 259, this.context) ) {
            case 1:
                {
                this.state = 1253;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 1252;
                    this.match(CypherParser.SP);
                    }
                }

                this.state = 1255;
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
            this.state = 1258;
            this.match(CypherParser.COUNT);
            this.state = 1260;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 1259;
                this.match(CypherParser.SP);
                }
            }

            this.state = 1262;
            this.match(CypherParser.LPAREN);
            this.state = 1264;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 1263;
                this.match(CypherParser.SP);
                }
            }

            this.state = 1266;
            this.match(CypherParser.MULT);
            this.state = 1268;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 1267;
                this.match(CypherParser.SP);
                }
            }

            this.state = 1270;
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
            this.state = 1272;
            this.expression();
            this.state = 1283;
            this.errorHandler.sync(this);
            alternative = this.interpreter.adaptivePredict(this.tokenStream, 265, this.context);
            while (alternative !== 2 && alternative !== antlr.ATN.INVALID_ALT_NUMBER) {
                if (alternative === 1) {
                    {
                    {
                    this.state = 1274;
                    this.errorHandler.sync(this);
                    _la = this.tokenStream.LA(1);
                    if (_la === 99) {
                        {
                        this.state = 1273;
                        this.match(CypherParser.SP);
                        }
                    }

                    this.state = 1276;
                    this.match(CypherParser.COMMA);
                    this.state = 1278;
                    this.errorHandler.sync(this);
                    switch (this.interpreter.adaptivePredict(this.tokenStream, 264, this.context) ) {
                    case 1:
                        {
                        this.state = 1277;
                        this.match(CypherParser.SP);
                        }
                        break;
                    }
                    this.state = 1280;
                    this.expression();
                    }
                    }
                }
                this.state = 1285;
                this.errorHandler.sync(this);
                alternative = this.interpreter.adaptivePredict(this.tokenStream, 265, this.context);
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
            this.state = 1286;
            this.match(CypherParser.CASE);
            this.state = 1288;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 266, this.context) ) {
            case 1:
                {
                this.state = 1287;
                this.match(CypherParser.SP);
                }
                break;
            }
            this.state = 1291;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 267, this.context) ) {
            case 1:
                {
                this.state = 1290;
                this.expression();
                }
                break;
            }
            this.state = 1310;
            this.errorHandler.sync(this);
            alternative = 1;
            do {
                switch (alternative) {
                case 1:
                    {
                    {
                    this.state = 1294;
                    this.errorHandler.sync(this);
                    _la = this.tokenStream.LA(1);
                    if (_la === 99) {
                        {
                        this.state = 1293;
                        this.match(CypherParser.SP);
                        }
                    }

                    this.state = 1296;
                    this.match(CypherParser.WHEN);
                    this.state = 1298;
                    this.errorHandler.sync(this);
                    switch (this.interpreter.adaptivePredict(this.tokenStream, 269, this.context) ) {
                    case 1:
                        {
                        this.state = 1297;
                        this.match(CypherParser.SP);
                        }
                        break;
                    }
                    this.state = 1300;
                    this.expression();
                    this.state = 1302;
                    this.errorHandler.sync(this);
                    _la = this.tokenStream.LA(1);
                    if (_la === 99) {
                        {
                        this.state = 1301;
                        this.match(CypherParser.SP);
                        }
                    }

                    this.state = 1304;
                    this.match(CypherParser.THEN);
                    this.state = 1306;
                    this.errorHandler.sync(this);
                    switch (this.interpreter.adaptivePredict(this.tokenStream, 271, this.context) ) {
                    case 1:
                        {
                        this.state = 1305;
                        this.match(CypherParser.SP);
                        }
                        break;
                    }
                    this.state = 1308;
                    this.expression();
                    }
                    }
                    break;
                default:
                    throw new antlr.NoViableAltException(this);
                }
                this.state = 1312;
                this.errorHandler.sync(this);
                alternative = this.interpreter.adaptivePredict(this.tokenStream, 272, this.context);
            } while (alternative !== 2 && alternative !== antlr.ATN.INVALID_ALT_NUMBER);
            this.state = 1322;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 275, this.context) ) {
            case 1:
                {
                this.state = 1315;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 99) {
                    {
                    this.state = 1314;
                    this.match(CypherParser.SP);
                    }
                }

                this.state = 1317;
                this.match(CypherParser.ELSE);
                this.state = 1319;
                this.errorHandler.sync(this);
                switch (this.interpreter.adaptivePredict(this.tokenStream, 274, this.context) ) {
                case 1:
                    {
                    this.state = 1318;
                    this.match(CypherParser.SP);
                    }
                    break;
                }
                this.state = 1321;
                this.expression();
                }
                break;
            }
            this.state = 1325;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 1324;
                this.match(CypherParser.SP);
                }
            }

            this.state = 1327;
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
            this.state = 1329;
            this.match(CypherParser.DOLLAR);
            this.state = 1332;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 277, this.context) ) {
            case 1:
                {
                this.state = 1330;
                this.symbol_();
                }
                break;
            case 2:
                {
                this.state = 1331;
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
            this.state = 1341;
            this.errorHandler.sync(this);
            switch (this.tokenStream.LA(1)) {
            case CypherParser.FALSE:
            case CypherParser.TRUE:
                this.enterOuterAlt(localContext, 1);
                {
                this.state = 1334;
                this.boolLit();
                }
                break;
            case CypherParser.DIGIT:
                this.enterOuterAlt(localContext, 2);
                {
                this.state = 1335;
                this.numLit();
                }
                break;
            case CypherParser.NULL_W:
                this.enterOuterAlt(localContext, 3);
                {
                this.state = 1336;
                this.match(CypherParser.NULL_W);
                }
                break;
            case CypherParser.STRING_LITERAL:
                this.enterOuterAlt(localContext, 4);
                {
                this.state = 1337;
                this.stringLit();
                }
                break;
            case CypherParser.CHAR_LITERAL:
                this.enterOuterAlt(localContext, 5);
                {
                this.state = 1338;
                this.charLit();
                }
                break;
            case CypherParser.LBRACK:
                this.enterOuterAlt(localContext, 6);
                {
                this.state = 1339;
                this.listLit();
                }
                break;
            case CypherParser.LBRACE:
                this.enterOuterAlt(localContext, 7);
                {
                this.state = 1340;
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
            this.state = 1343;
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
            this.state = 1345;
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
            this.state = 1347;
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
            this.state = 1349;
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
            this.state = 1351;
            this.match(CypherParser.LBRACK);
            this.state = 1353;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 279, this.context) ) {
            case 1:
                {
                this.state = 1352;
                this.match(CypherParser.SP);
                }
                break;
            }
            this.state = 1356;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 280, this.context) ) {
            case 1:
                {
                this.state = 1355;
                this.expressionChain();
                }
                break;
            }
            this.state = 1359;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 1358;
                this.match(CypherParser.SP);
                }
            }

            this.state = 1361;
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
            this.state = 1363;
            this.match(CypherParser.LBRACE);
            this.state = 1365;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 282, this.context) ) {
            case 1:
                {
                this.state = 1364;
                this.match(CypherParser.SP);
                }
                break;
            }
            this.state = 1381;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 30 || _la === 31 || ((((_la - 32)) & ~0x1F) === 0 && ((1 << (_la - 32)) & 4294967295) !== 0) || ((((_la - 64)) & ~0x1F) === 0 && ((1 << (_la - 64)) & 3019898879) !== 0)) {
                {
                this.state = 1367;
                this.mapPair();
                this.state = 1378;
                this.errorHandler.sync(this);
                alternative = this.interpreter.adaptivePredict(this.tokenStream, 285, this.context);
                while (alternative !== 2 && alternative !== antlr.ATN.INVALID_ALT_NUMBER) {
                    if (alternative === 1) {
                        {
                        {
                        this.state = 1369;
                        this.errorHandler.sync(this);
                        _la = this.tokenStream.LA(1);
                        if (_la === 99) {
                            {
                            this.state = 1368;
                            this.match(CypherParser.SP);
                            }
                        }

                        this.state = 1371;
                        this.match(CypherParser.COMMA);
                        this.state = 1373;
                        this.errorHandler.sync(this);
                        _la = this.tokenStream.LA(1);
                        if (_la === 99) {
                            {
                            this.state = 1372;
                            this.match(CypherParser.SP);
                            }
                        }

                        this.state = 1375;
                        this.mapPair();
                        }
                        }
                    }
                    this.state = 1380;
                    this.errorHandler.sync(this);
                    alternative = this.interpreter.adaptivePredict(this.tokenStream, 285, this.context);
                }
                }
            }

            this.state = 1384;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 1383;
                this.match(CypherParser.SP);
                }
            }

            this.state = 1386;
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
            this.state = 1388;
            this.name();
            this.state = 1390;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 99) {
                {
                this.state = 1389;
                this.match(CypherParser.SP);
                }
            }

            this.state = 1392;
            this.match(CypherParser.COLON);
            this.state = 1394;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 289, this.context) ) {
            case 1:
                {
                this.state = 1393;
                this.match(CypherParser.SP);
                }
                break;
            }
            this.state = 1396;
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
            this.state = 1400;
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
                this.state = 1398;
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
                this.state = 1399;
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
            this.state = 1402;
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
            this.state = 1404;
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
        4,1,101,1407,2,0,7,0,2,1,7,1,2,2,7,2,2,3,7,3,2,4,7,4,2,5,7,5,2,6,
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
        8,1,1,2,1,2,3,2,200,8,2,1,2,5,2,203,8,2,10,2,12,2,206,9,2,1,3,1,
        3,3,3,210,8,3,1,4,1,4,3,4,214,8,4,1,4,1,4,3,4,218,8,4,1,4,3,4,221,
        8,4,1,4,3,4,224,8,4,1,4,1,4,3,4,228,8,4,1,4,1,4,3,4,232,8,4,3,4,
        234,8,4,1,5,1,5,3,5,238,8,5,1,5,1,5,1,6,1,6,3,6,244,8,6,1,6,1,6,
        3,6,248,8,6,1,6,3,6,251,8,6,1,7,1,7,3,7,255,8,7,1,7,1,7,1,8,1,8,
        3,8,261,8,8,1,8,1,8,1,9,3,9,266,8,9,1,9,3,9,269,8,9,1,9,3,9,272,
        8,9,1,9,1,9,3,9,276,8,9,1,9,3,9,279,8,9,1,9,3,9,282,8,9,1,9,3,9,
        285,8,9,1,9,3,9,288,8,9,1,9,3,9,291,8,9,1,10,1,10,3,10,295,8,10,
        1,10,3,10,298,8,10,1,10,1,10,3,10,302,8,10,1,10,5,10,305,8,10,10,
        10,12,10,308,9,10,1,11,1,11,3,11,312,8,11,1,11,1,11,3,11,316,8,11,
        1,11,3,11,319,8,11,1,12,1,12,3,12,323,8,12,1,12,3,12,326,8,12,1,
        13,1,13,3,13,330,8,13,1,13,1,13,3,13,334,8,13,1,13,1,13,3,13,338,
        8,13,1,13,1,13,3,13,342,8,13,1,13,5,13,345,8,13,10,13,12,13,348,
        9,13,1,14,1,14,3,14,352,8,14,5,14,354,8,14,10,14,12,14,357,9,14,
        1,14,1,14,1,14,3,14,362,8,14,4,14,364,8,14,11,14,12,14,365,1,14,
        3,14,369,8,14,1,14,3,14,372,8,14,3,14,374,8,14,1,15,1,15,3,15,378,
        8,15,5,15,380,8,15,10,15,12,15,383,9,15,1,15,1,15,3,15,387,8,15,
        5,15,389,8,15,10,15,12,15,392,9,15,1,15,1,15,3,15,396,8,15,1,15,
        1,15,1,16,1,16,3,16,402,8,16,1,16,1,16,3,16,406,8,16,1,16,1,16,1,
        17,1,17,3,17,412,8,17,1,17,1,17,3,17,416,8,17,1,17,1,17,3,17,420,
        8,17,1,17,1,17,1,18,1,18,1,18,3,18,427,8,18,1,19,1,19,1,19,1,19,
        1,19,3,19,434,8,19,1,20,1,20,3,20,438,8,20,1,20,1,20,3,20,442,8,
        20,1,20,1,20,1,21,1,21,3,21,448,8,21,1,21,1,21,3,21,452,8,21,1,21,
        1,21,3,21,456,8,21,1,21,5,21,459,8,21,10,21,12,21,462,9,21,1,22,
        1,22,3,22,466,8,22,1,22,1,22,1,22,3,22,471,8,22,1,23,1,23,3,23,475,
        8,23,1,23,1,23,3,23,479,8,23,1,23,1,23,3,23,483,8,23,1,23,1,23,3,
        23,487,8,23,1,23,3,23,490,8,23,1,24,1,24,3,24,494,8,24,1,24,3,24,
        497,8,24,1,24,3,24,500,8,24,1,24,1,24,1,25,1,25,3,25,506,8,25,1,
        25,1,25,3,25,510,8,25,1,25,5,25,513,8,25,10,25,12,25,516,9,25,1,
        25,3,25,519,8,25,1,25,3,25,522,8,25,1,26,1,26,3,26,526,8,26,1,26,
        1,26,3,26,530,8,26,3,26,532,8,26,1,26,1,26,1,27,1,27,3,27,538,8,
        27,1,27,1,27,3,27,542,8,27,1,27,5,27,545,8,27,10,27,12,27,548,9,
        27,1,28,1,28,3,28,552,8,28,1,28,1,28,3,28,556,8,28,1,28,1,28,1,29,
        1,29,3,29,562,8,29,1,29,1,29,3,29,566,8,29,1,29,1,29,3,29,570,8,
        29,1,29,5,29,573,8,29,10,29,12,29,576,9,29,1,30,1,30,3,30,580,8,
        30,1,30,1,30,3,30,584,8,30,1,30,1,30,1,30,1,30,3,30,590,8,30,1,30,
        1,30,3,30,594,8,30,1,30,1,30,1,30,1,30,3,30,600,8,30,1,30,1,30,3,
        30,604,8,30,1,31,1,31,3,31,608,8,31,1,31,4,31,611,8,31,11,31,12,
        31,612,1,32,1,32,3,32,617,8,32,1,32,1,32,1,33,1,33,3,33,623,8,33,
        1,33,3,33,626,8,33,1,34,1,34,3,34,630,8,34,1,34,1,34,1,35,1,35,3,
        35,636,8,35,1,35,1,35,3,35,640,8,35,1,35,5,35,643,8,35,10,35,12,
        35,646,9,35,1,36,1,36,3,36,650,8,36,1,36,1,36,3,36,654,8,36,1,36,
        5,36,657,8,36,10,36,12,36,660,9,36,1,37,1,37,3,37,664,8,37,1,37,
        1,37,3,37,668,8,37,1,37,5,37,671,8,37,10,37,12,37,674,9,37,1,38,
        1,38,3,38,678,8,38,1,38,1,38,3,38,682,8,38,1,38,5,38,685,8,38,10,
        38,12,38,688,9,38,1,39,1,39,3,39,692,8,39,5,39,694,8,39,10,39,12,
        39,697,9,39,1,39,1,39,1,40,1,40,3,40,703,8,40,1,40,1,40,3,40,707,
        8,40,1,40,1,40,5,40,711,8,40,10,40,12,40,714,9,40,1,41,1,41,1,42,
        1,42,3,42,720,8,42,1,42,1,42,3,42,724,8,42,1,42,5,42,727,8,42,10,
        42,12,42,730,9,42,1,43,1,43,3,43,734,8,43,1,43,1,43,3,43,738,8,43,
        1,43,5,43,741,8,43,10,43,12,43,744,9,43,1,44,1,44,3,44,748,8,44,
        1,44,1,44,3,44,752,8,44,1,44,5,44,755,8,44,10,44,12,44,758,9,44,
        1,45,3,45,761,8,45,1,45,3,45,764,8,45,1,45,1,45,1,46,1,46,3,46,770,
        8,46,1,46,1,46,1,46,3,46,775,8,46,5,46,777,8,46,10,46,12,46,780,
        9,46,1,47,3,47,783,8,47,1,47,1,47,3,47,787,8,47,1,47,1,47,1,47,3,
        47,792,8,47,1,47,3,47,795,8,47,1,47,3,47,798,8,47,1,47,1,47,3,47,
        802,8,47,1,47,3,47,805,8,47,1,47,3,47,808,8,47,1,47,3,47,811,8,47,
        1,47,3,47,814,8,47,1,48,1,48,3,48,818,8,48,1,48,1,48,1,49,1,49,3,
        49,824,8,49,1,49,1,49,1,49,3,49,829,8,49,1,49,1,49,3,49,833,8,49,
        1,50,3,50,836,8,50,1,50,1,50,3,50,840,8,50,1,50,3,50,843,8,50,1,
        50,3,50,846,8,50,1,50,1,50,1,51,1,51,3,51,852,8,51,1,51,3,51,855,
        8,51,1,52,1,52,3,52,859,8,52,1,52,1,52,3,52,863,8,52,1,52,5,52,866,
        8,52,10,52,12,52,869,9,52,1,53,1,53,3,53,873,8,53,1,53,1,53,3,53,
        877,8,53,3,53,879,8,53,1,53,1,53,1,54,1,54,3,54,885,8,54,1,54,5,
        54,888,8,54,10,54,12,54,891,9,54,1,54,1,54,3,54,895,8,54,1,54,1,
        54,3,54,899,8,54,1,54,1,54,1,54,3,54,904,8,54,1,55,1,55,3,55,908,
        8,55,1,55,1,55,1,56,1,56,3,56,914,8,56,1,57,1,57,3,57,918,8,57,1,
        57,3,57,921,8,57,1,57,3,57,924,8,57,1,57,3,57,927,8,57,1,57,3,57,
        930,8,57,1,57,3,57,933,8,57,1,57,3,57,936,8,57,1,57,1,57,1,58,1,
        58,1,58,1,58,1,58,1,58,1,58,1,58,1,58,1,58,1,58,1,58,3,58,952,8,
        58,1,59,1,59,1,59,1,60,1,60,3,60,959,8,60,1,60,1,60,3,60,963,8,60,
        1,60,3,60,966,8,60,1,60,3,60,969,8,60,1,60,1,60,3,60,973,8,60,1,
        60,3,60,976,8,60,1,60,1,60,3,60,980,8,60,1,60,3,60,983,8,60,1,60,
        3,60,986,8,60,1,60,1,60,3,60,990,8,60,1,60,3,60,993,8,60,3,60,995,
        8,60,1,61,1,61,3,61,999,8,61,1,61,3,61,1002,8,61,1,61,3,61,1005,
        8,61,1,61,3,61,1008,8,61,1,61,3,61,1011,8,61,1,61,3,61,1014,8,61,
        1,61,3,61,1017,8,61,1,61,3,61,1020,8,61,1,61,3,61,1023,8,61,1,61,
        1,61,1,62,1,62,3,62,1029,8,62,1,62,3,62,1032,8,62,1,62,3,62,1035,
        8,62,1,62,1,62,3,62,1039,8,62,1,62,3,62,1042,8,62,3,62,1044,8,62,
        1,63,1,63,3,63,1048,8,63,1,63,1,63,3,63,1052,8,63,1,63,1,63,3,63,
        1056,8,63,1,63,3,63,1059,8,63,1,63,3,63,1062,8,63,1,63,5,63,1065,
        8,63,10,63,12,63,1068,9,63,1,64,1,64,3,64,1072,8,64,1,64,3,64,1075,
        8,64,1,64,3,64,1078,8,64,1,64,1,64,1,65,1,65,3,65,1084,8,65,1,65,
        1,65,3,65,1088,8,65,1,65,1,65,3,65,1092,8,65,1,65,3,65,1095,8,65,
        1,65,1,65,1,66,1,66,3,66,1101,8,66,1,66,1,66,3,66,1105,8,66,1,66,
        5,66,1108,8,66,10,66,12,66,1111,9,66,1,67,1,67,3,67,1115,8,67,1,
        67,1,67,3,67,1119,8,67,1,67,1,67,3,67,1123,8,67,3,67,1125,8,67,1,
        67,1,67,3,67,1129,8,67,1,67,1,67,1,67,1,67,3,67,1135,8,67,1,67,1,
        67,3,67,1139,8,67,1,67,1,67,3,67,1143,8,67,3,67,1145,8,67,1,67,3,
        67,1148,8,67,1,67,3,67,1151,8,67,1,67,1,67,3,67,1155,8,67,1,68,1,
        68,3,68,1159,8,68,1,68,1,68,3,68,1163,8,68,1,68,1,68,1,69,1,69,3,
        69,1169,8,69,1,69,1,69,3,69,1173,8,69,1,69,1,69,3,69,1177,8,69,1,
        69,1,69,1,70,1,70,3,70,1183,8,70,1,70,1,70,3,70,1187,8,70,1,70,1,
        70,3,70,1191,8,70,3,70,1193,8,70,1,70,1,70,3,70,1197,8,70,1,70,3,
        70,1200,8,70,1,70,3,70,1203,8,70,1,70,1,70,3,70,1207,8,70,1,70,1,
        70,3,70,1211,8,70,1,70,1,70,1,71,1,71,3,71,1217,8,71,1,71,4,71,1220,
        8,71,11,71,12,71,1221,1,72,1,72,3,72,1226,8,72,1,72,1,72,3,72,1230,
        8,72,1,72,1,72,3,72,1234,8,72,1,72,3,72,1237,8,72,1,72,3,72,1240,
        8,72,1,72,1,72,1,73,1,73,3,73,1246,8,73,1,73,1,73,3,73,1250,8,73,
        1,73,1,73,3,73,1254,8,73,1,73,3,73,1257,8,73,1,74,1,74,3,74,1261,
        8,74,1,74,1,74,3,74,1265,8,74,1,74,1,74,3,74,1269,8,74,1,74,1,74,
        1,75,1,75,3,75,1275,8,75,1,75,1,75,3,75,1279,8,75,1,75,5,75,1282,
        8,75,10,75,12,75,1285,9,75,1,76,1,76,3,76,1289,8,76,1,76,3,76,1292,
        8,76,1,76,3,76,1295,8,76,1,76,1,76,3,76,1299,8,76,1,76,1,76,3,76,
        1303,8,76,1,76,1,76,3,76,1307,8,76,1,76,1,76,4,76,1311,8,76,11,76,
        12,76,1312,1,76,3,76,1316,8,76,1,76,1,76,3,76,1320,8,76,1,76,3,76,
        1323,8,76,1,76,3,76,1326,8,76,1,76,1,76,1,77,1,77,1,77,3,77,1333,
        8,77,1,78,1,78,1,78,1,78,1,78,1,78,1,78,3,78,1342,8,78,1,79,1,79,
        1,80,1,80,1,81,1,81,1,82,1,82,1,83,1,83,3,83,1354,8,83,1,83,3,83,
        1357,8,83,1,83,3,83,1360,8,83,1,83,1,83,1,84,1,84,3,84,1366,8,84,
        1,84,1,84,3,84,1370,8,84,1,84,1,84,3,84,1374,8,84,1,84,5,84,1377,
        8,84,10,84,12,84,1380,9,84,3,84,1382,8,84,1,84,3,84,1385,8,84,1,
        84,1,84,1,85,1,85,3,85,1391,8,85,1,85,1,85,3,85,1395,8,85,1,85,1,
        85,1,86,1,86,3,86,1401,8,86,1,87,1,87,1,88,1,88,1,88,0,0,89,0,2,
        4,6,8,10,12,14,16,18,20,22,24,26,28,30,32,34,36,38,40,42,44,46,48,
        50,52,54,56,58,60,62,64,66,68,70,72,74,76,78,80,82,84,86,88,90,92,
        94,96,98,100,102,104,106,108,110,112,114,116,118,120,122,124,126,
        128,130,132,134,136,138,140,142,144,146,148,150,152,154,156,158,
        160,162,164,166,168,170,172,174,176,0,10,2,0,37,38,42,43,2,0,40,
        40,47,47,1,0,1,2,2,0,1,1,3,7,1,0,18,19,2,0,20,21,23,23,1,0,33,36,
        1,0,71,72,4,0,30,35,89,89,92,93,95,95,1,0,36,88,1631,0,179,1,0,0,
        0,2,195,1,0,0,0,4,197,1,0,0,0,6,209,1,0,0,0,8,211,1,0,0,0,10,235,
        1,0,0,0,12,241,1,0,0,0,14,252,1,0,0,0,16,258,1,0,0,0,18,268,1,0,
        0,0,20,294,1,0,0,0,22,309,1,0,0,0,24,320,1,0,0,0,26,327,1,0,0,0,
        28,355,1,0,0,0,30,381,1,0,0,0,32,401,1,0,0,0,34,409,1,0,0,0,36,426,
        1,0,0,0,38,433,1,0,0,0,40,437,1,0,0,0,42,445,1,0,0,0,44,470,1,0,
        0,0,46,472,1,0,0,0,48,491,1,0,0,0,50,503,1,0,0,0,52,531,1,0,0,0,
        54,535,1,0,0,0,56,549,1,0,0,0,58,559,1,0,0,0,60,603,1,0,0,0,62,610,
        1,0,0,0,64,614,1,0,0,0,66,620,1,0,0,0,68,627,1,0,0,0,70,633,1,0,
        0,0,72,647,1,0,0,0,74,661,1,0,0,0,76,675,1,0,0,0,78,695,1,0,0,0,
        80,700,1,0,0,0,82,715,1,0,0,0,84,717,1,0,0,0,86,731,1,0,0,0,88,745,
        1,0,0,0,90,760,1,0,0,0,92,767,1,0,0,0,94,813,1,0,0,0,96,815,1,0,
        0,0,98,832,1,0,0,0,100,835,1,0,0,0,102,849,1,0,0,0,104,856,1,0,0,
        0,106,878,1,0,0,0,108,903,1,0,0,0,110,905,1,0,0,0,112,913,1,0,0,
        0,114,915,1,0,0,0,116,951,1,0,0,0,118,953,1,0,0,0,120,994,1,0,0,
        0,122,996,1,0,0,0,124,1026,1,0,0,0,126,1045,1,0,0,0,128,1069,1,0,
        0,0,130,1081,1,0,0,0,132,1098,1,0,0,0,134,1154,1,0,0,0,136,1156,
        1,0,0,0,138,1166,1,0,0,0,140,1180,1,0,0,0,142,1214,1,0,0,0,144,1223,
        1,0,0,0,146,1243,1,0,0,0,148,1258,1,0,0,0,150,1272,1,0,0,0,152,1286,
        1,0,0,0,154,1329,1,0,0,0,156,1341,1,0,0,0,158,1343,1,0,0,0,160,1345,
        1,0,0,0,162,1347,1,0,0,0,164,1349,1,0,0,0,166,1351,1,0,0,0,168,1363,
        1,0,0,0,170,1388,1,0,0,0,172,1400,1,0,0,0,174,1402,1,0,0,0,176,1404,
        1,0,0,0,178,180,5,99,0,0,179,178,1,0,0,0,179,180,1,0,0,0,180,181,
        1,0,0,0,181,183,3,2,1,0,182,184,5,99,0,0,183,182,1,0,0,0,183,184,
        1,0,0,0,184,186,1,0,0,0,185,187,5,9,0,0,186,185,1,0,0,0,186,187,
        1,0,0,0,187,189,1,0,0,0,188,190,5,99,0,0,189,188,1,0,0,0,189,190,
        1,0,0,0,190,191,1,0,0,0,191,192,5,0,0,1,192,1,1,0,0,0,193,196,3,
        4,2,0,194,196,3,8,4,0,195,193,1,0,0,0,195,194,1,0,0,0,196,3,1,0,
        0,0,197,204,3,6,3,0,198,200,5,99,0,0,199,198,1,0,0,0,199,200,1,0,
        0,0,200,201,1,0,0,0,201,203,3,128,64,0,202,199,1,0,0,0,203,206,1,
        0,0,0,204,202,1,0,0,0,204,205,1,0,0,0,205,5,1,0,0,0,206,204,1,0,
        0,0,207,210,3,28,14,0,208,210,3,30,15,0,209,207,1,0,0,0,209,208,
        1,0,0,0,210,7,1,0,0,0,211,213,5,28,0,0,212,214,5,99,0,0,213,212,
        1,0,0,0,213,214,1,0,0,0,214,215,1,0,0,0,215,217,3,132,66,0,216,218,
        5,99,0,0,217,216,1,0,0,0,217,218,1,0,0,0,218,220,1,0,0,0,219,221,
        3,48,24,0,220,219,1,0,0,0,220,221,1,0,0,0,221,233,1,0,0,0,222,224,
        5,99,0,0,223,222,1,0,0,0,223,224,1,0,0,0,224,225,1,0,0,0,225,227,
        5,29,0,0,226,228,5,99,0,0,227,226,1,0,0,0,227,228,1,0,0,0,228,231,
        1,0,0,0,229,232,5,23,0,0,230,232,3,50,25,0,231,229,1,0,0,0,231,230,
        1,0,0,0,232,234,1,0,0,0,233,223,1,0,0,0,233,234,1,0,0,0,234,9,1,
        0,0,0,235,237,5,53,0,0,236,238,5,99,0,0,237,236,1,0,0,0,237,238,
        1,0,0,0,238,239,1,0,0,0,239,240,3,18,9,0,240,11,1,0,0,0,241,243,
        5,57,0,0,242,244,5,99,0,0,243,242,1,0,0,0,243,244,1,0,0,0,244,245,
        1,0,0,0,245,250,3,18,9,0,246,248,5,99,0,0,247,246,1,0,0,0,247,248,
        1,0,0,0,248,249,1,0,0,0,249,251,3,68,34,0,250,247,1,0,0,0,250,251,
        1,0,0,0,251,13,1,0,0,0,252,254,5,55,0,0,253,255,5,99,0,0,254,253,
        1,0,0,0,254,255,1,0,0,0,255,256,1,0,0,0,256,257,3,72,36,0,257,15,
        1,0,0,0,258,260,5,46,0,0,259,261,5,99,0,0,260,259,1,0,0,0,260,261,
        1,0,0,0,261,262,1,0,0,0,262,263,3,72,36,0,263,17,1,0,0,0,264,266,
        5,99,0,0,265,264,1,0,0,0,265,266,1,0,0,0,266,267,1,0,0,0,267,269,
        5,63,0,0,268,265,1,0,0,0,268,269,1,0,0,0,269,271,1,0,0,0,270,272,
        5,99,0,0,271,270,1,0,0,0,271,272,1,0,0,0,272,273,1,0,0,0,273,278,
        3,20,10,0,274,276,5,99,0,0,275,274,1,0,0,0,275,276,1,0,0,0,276,277,
        1,0,0,0,277,279,3,26,13,0,278,275,1,0,0,0,278,279,1,0,0,0,279,284,
        1,0,0,0,280,282,5,99,0,0,281,280,1,0,0,0,281,282,1,0,0,0,282,283,
        1,0,0,0,283,285,3,14,7,0,284,281,1,0,0,0,284,285,1,0,0,0,285,290,
        1,0,0,0,286,288,5,99,0,0,287,286,1,0,0,0,287,288,1,0,0,0,288,289,
        1,0,0,0,289,291,3,16,8,0,290,287,1,0,0,0,290,291,1,0,0,0,291,19,
        1,0,0,0,292,295,5,23,0,0,293,295,3,22,11,0,294,292,1,0,0,0,294,293,
        1,0,0,0,295,306,1,0,0,0,296,298,5,99,0,0,297,296,1,0,0,0,297,298,
        1,0,0,0,298,299,1,0,0,0,299,301,5,11,0,0,300,302,5,99,0,0,301,300,
        1,0,0,0,301,302,1,0,0,0,302,303,1,0,0,0,303,305,3,22,11,0,304,297,
        1,0,0,0,305,308,1,0,0,0,306,304,1,0,0,0,306,307,1,0,0,0,307,21,1,
        0,0,0,308,306,1,0,0,0,309,318,3,72,36,0,310,312,5,99,0,0,311,310,
        1,0,0,0,311,312,1,0,0,0,312,313,1,0,0,0,313,315,5,61,0,0,314,316,
        5,99,0,0,315,314,1,0,0,0,315,316,1,0,0,0,316,317,1,0,0,0,317,319,
        3,174,87,0,318,311,1,0,0,0,318,319,1,0,0,0,319,23,1,0,0,0,320,325,
        3,72,36,0,321,323,5,99,0,0,322,321,1,0,0,0,322,323,1,0,0,0,323,324,
        1,0,0,0,324,326,7,0,0,0,325,322,1,0,0,0,325,326,1,0,0,0,326,25,1,
        0,0,0,327,329,5,51,0,0,328,330,5,99,0,0,329,328,1,0,0,0,329,330,
        1,0,0,0,330,331,1,0,0,0,331,333,5,39,0,0,332,334,5,99,0,0,333,332,
        1,0,0,0,333,334,1,0,0,0,334,335,1,0,0,0,335,346,3,24,12,0,336,338,
        5,99,0,0,337,336,1,0,0,0,337,338,1,0,0,0,338,339,1,0,0,0,339,341,
        5,11,0,0,340,342,5,99,0,0,341,340,1,0,0,0,341,342,1,0,0,0,342,343,
        1,0,0,0,343,345,3,24,12,0,344,337,1,0,0,0,345,348,1,0,0,0,346,344,
        1,0,0,0,346,347,1,0,0,0,347,27,1,0,0,0,348,346,1,0,0,0,349,351,3,
        36,18,0,350,352,5,99,0,0,351,350,1,0,0,0,351,352,1,0,0,0,352,354,
        1,0,0,0,353,349,1,0,0,0,354,357,1,0,0,0,355,353,1,0,0,0,355,356,
        1,0,0,0,356,373,1,0,0,0,357,355,1,0,0,0,358,374,3,10,5,0,359,361,
        3,38,19,0,360,362,5,99,0,0,361,360,1,0,0,0,361,362,1,0,0,0,362,364,
        1,0,0,0,363,359,1,0,0,0,364,365,1,0,0,0,365,363,1,0,0,0,365,366,
        1,0,0,0,366,371,1,0,0,0,367,369,5,99,0,0,368,367,1,0,0,0,368,369,
        1,0,0,0,369,370,1,0,0,0,370,372,3,10,5,0,371,368,1,0,0,0,371,372,
        1,0,0,0,372,374,1,0,0,0,373,358,1,0,0,0,373,363,1,0,0,0,374,29,1,
        0,0,0,375,377,3,36,18,0,376,378,5,99,0,0,377,376,1,0,0,0,377,378,
        1,0,0,0,378,380,1,0,0,0,379,375,1,0,0,0,380,383,1,0,0,0,381,379,
        1,0,0,0,381,382,1,0,0,0,382,390,1,0,0,0,383,381,1,0,0,0,384,386,
        3,38,19,0,385,387,5,99,0,0,386,385,1,0,0,0,386,387,1,0,0,0,387,389,
        1,0,0,0,388,384,1,0,0,0,389,392,1,0,0,0,390,388,1,0,0,0,390,391,
        1,0,0,0,391,393,1,0,0,0,392,390,1,0,0,0,393,395,3,12,6,0,394,396,
        5,99,0,0,395,394,1,0,0,0,395,396,1,0,0,0,396,397,1,0,0,0,397,398,
        3,28,14,0,398,31,1,0,0,0,399,400,5,50,0,0,400,402,5,99,0,0,401,399,
        1,0,0,0,401,402,1,0,0,0,402,403,1,0,0,0,403,405,5,47,0,0,404,406,
        5,99,0,0,405,404,1,0,0,0,405,406,1,0,0,0,406,407,1,0,0,0,407,408,
        3,66,33,0,408,33,1,0,0,0,409,411,5,59,0,0,410,412,5,99,0,0,411,410,
        1,0,0,0,411,412,1,0,0,0,412,413,1,0,0,0,413,415,3,72,36,0,414,416,
        5,99,0,0,415,414,1,0,0,0,415,416,1,0,0,0,416,417,1,0,0,0,417,419,
        5,61,0,0,418,420,5,99,0,0,419,418,1,0,0,0,419,420,1,0,0,0,420,421,
        1,0,0,0,421,422,3,174,87,0,422,35,1,0,0,0,423,427,3,32,16,0,424,
        427,3,34,17,0,425,427,3,46,23,0,426,423,1,0,0,0,426,424,1,0,0,0,
        426,425,1,0,0,0,427,37,1,0,0,0,428,434,3,64,32,0,429,434,3,54,27,
        0,430,434,3,40,20,0,431,434,3,58,29,0,432,434,3,42,21,0,433,428,
        1,0,0,0,433,429,1,0,0,0,433,430,1,0,0,0,433,431,1,0,0,0,433,432,
        1,0,0,0,434,39,1,0,0,0,435,436,5,44,0,0,436,438,5,99,0,0,437,435,
        1,0,0,0,437,438,1,0,0,0,438,439,1,0,0,0,439,441,5,41,0,0,440,442,
        5,99,0,0,441,440,1,0,0,0,441,442,1,0,0,0,442,443,1,0,0,0,443,444,
        3,150,75,0,444,41,1,0,0,0,445,447,5,52,0,0,446,448,5,99,0,0,447,
        446,1,0,0,0,447,448,1,0,0,0,448,449,1,0,0,0,449,460,3,44,22,0,450,
        452,5,99,0,0,451,450,1,0,0,0,451,452,1,0,0,0,452,453,1,0,0,0,453,
        455,5,11,0,0,454,456,5,99,0,0,455,454,1,0,0,0,455,456,1,0,0,0,456,
        457,1,0,0,0,457,459,3,44,22,0,458,451,1,0,0,0,459,462,1,0,0,0,460,
        458,1,0,0,0,460,461,1,0,0,0,461,43,1,0,0,0,462,460,1,0,0,0,463,465,
        3,174,87,0,464,466,5,99,0,0,465,464,1,0,0,0,465,466,1,0,0,0,466,
        467,1,0,0,0,467,468,3,62,31,0,468,471,1,0,0,0,469,471,3,104,52,0,
        470,463,1,0,0,0,470,469,1,0,0,0,471,45,1,0,0,0,472,474,5,28,0,0,
        473,475,5,99,0,0,474,473,1,0,0,0,474,475,1,0,0,0,475,476,1,0,0,0,
        476,478,3,132,66,0,477,479,5,99,0,0,478,477,1,0,0,0,478,479,1,0,
        0,0,479,480,1,0,0,0,480,489,3,48,24,0,481,483,5,99,0,0,482,481,1,
        0,0,0,482,483,1,0,0,0,483,484,1,0,0,0,484,486,5,29,0,0,485,487,5,
        99,0,0,486,485,1,0,0,0,486,487,1,0,0,0,487,488,1,0,0,0,488,490,3,
        50,25,0,489,482,1,0,0,0,489,490,1,0,0,0,490,47,1,0,0,0,491,493,5,
        12,0,0,492,494,5,99,0,0,493,492,1,0,0,0,493,494,1,0,0,0,494,496,
        1,0,0,0,495,497,3,150,75,0,496,495,1,0,0,0,496,497,1,0,0,0,497,499,
        1,0,0,0,498,500,5,99,0,0,499,498,1,0,0,0,499,500,1,0,0,0,500,501,
        1,0,0,0,501,502,5,13,0,0,502,49,1,0,0,0,503,514,3,52,26,0,504,506,
        5,99,0,0,505,504,1,0,0,0,505,506,1,0,0,0,506,507,1,0,0,0,507,509,
        5,11,0,0,508,510,5,99,0,0,509,508,1,0,0,0,509,510,1,0,0,0,510,511,
        1,0,0,0,511,513,3,52,26,0,512,505,1,0,0,0,513,516,1,0,0,0,514,512,
        1,0,0,0,514,515,1,0,0,0,515,521,1,0,0,0,516,514,1,0,0,0,517,519,
        5,99,0,0,518,517,1,0,0,0,518,519,1,0,0,0,519,520,1,0,0,0,520,522,
        3,68,34,0,521,518,1,0,0,0,521,522,1,0,0,0,522,51,1,0,0,0,523,525,
        3,174,87,0,524,526,5,99,0,0,525,524,1,0,0,0,525,526,1,0,0,0,526,
        527,1,0,0,0,527,529,5,61,0,0,528,530,5,99,0,0,529,528,1,0,0,0,529,
        530,1,0,0,0,530,532,1,0,0,0,531,523,1,0,0,0,531,532,1,0,0,0,532,
        533,1,0,0,0,533,534,3,174,87,0,534,53,1,0,0,0,535,537,5,48,0,0,536,
        538,5,99,0,0,537,536,1,0,0,0,537,538,1,0,0,0,538,539,1,0,0,0,539,
        546,3,106,53,0,540,542,5,99,0,0,541,540,1,0,0,0,541,542,1,0,0,0,
        542,543,1,0,0,0,543,545,3,56,28,0,544,541,1,0,0,0,545,548,1,0,0,
        0,546,544,1,0,0,0,546,547,1,0,0,0,547,55,1,0,0,0,548,546,1,0,0,0,
        549,551,5,49,0,0,550,552,5,99,0,0,551,550,1,0,0,0,551,552,1,0,0,
        0,552,553,1,0,0,0,553,555,7,1,0,0,554,556,5,99,0,0,555,554,1,0,0,
        0,555,556,1,0,0,0,556,557,1,0,0,0,557,558,3,58,29,0,558,57,1,0,0,
        0,559,561,5,54,0,0,560,562,5,99,0,0,561,560,1,0,0,0,561,562,1,0,
        0,0,562,563,1,0,0,0,563,574,3,60,30,0,564,566,5,99,0,0,565,564,1,
        0,0,0,565,566,1,0,0,0,566,567,1,0,0,0,567,569,5,11,0,0,568,570,5,
        99,0,0,569,568,1,0,0,0,569,570,1,0,0,0,570,571,1,0,0,0,571,573,3,
        60,30,0,572,565,1,0,0,0,573,576,1,0,0,0,574,572,1,0,0,0,574,575,
        1,0,0,0,575,59,1,0,0,0,576,574,1,0,0,0,577,579,3,104,52,0,578,580,
        5,99,0,0,579,578,1,0,0,0,579,580,1,0,0,0,580,581,1,0,0,0,581,583,
        5,1,0,0,582,584,5,99,0,0,583,582,1,0,0,0,583,584,1,0,0,0,584,585,
        1,0,0,0,585,586,3,72,36,0,586,604,1,0,0,0,587,589,3,174,87,0,588,
        590,5,99,0,0,589,588,1,0,0,0,589,590,1,0,0,0,590,591,1,0,0,0,591,
        593,7,2,0,0,592,594,5,99,0,0,593,592,1,0,0,0,593,594,1,0,0,0,594,
        595,1,0,0,0,595,596,3,72,36,0,596,604,1,0,0,0,597,599,3,174,87,0,
        598,600,5,99,0,0,599,598,1,0,0,0,599,600,1,0,0,0,600,601,1,0,0,0,
        601,602,3,62,31,0,602,604,1,0,0,0,603,577,1,0,0,0,603,587,1,0,0,
        0,603,597,1,0,0,0,604,61,1,0,0,0,605,607,5,25,0,0,606,608,5,99,0,
        0,607,606,1,0,0,0,607,608,1,0,0,0,608,609,1,0,0,0,609,611,3,172,
        86,0,610,605,1,0,0,0,611,612,1,0,0,0,612,610,1,0,0,0,612,613,1,0,
        0,0,613,63,1,0,0,0,614,616,5,40,0,0,615,617,5,99,0,0,616,615,1,0,
        0,0,616,617,1,0,0,0,617,618,1,0,0,0,618,619,3,70,35,0,619,65,1,0,
        0,0,620,625,3,70,35,0,621,623,5,99,0,0,622,621,1,0,0,0,622,623,1,
        0,0,0,623,624,1,0,0,0,624,626,3,68,34,0,625,622,1,0,0,0,625,626,
        1,0,0,0,626,67,1,0,0,0,627,629,5,56,0,0,628,630,5,99,0,0,629,628,
        1,0,0,0,629,630,1,0,0,0,630,631,1,0,0,0,631,632,3,72,36,0,632,69,
        1,0,0,0,633,644,3,106,53,0,634,636,5,99,0,0,635,634,1,0,0,0,635,
        636,1,0,0,0,636,637,1,0,0,0,637,639,5,11,0,0,638,640,5,99,0,0,639,
        638,1,0,0,0,639,640,1,0,0,0,640,641,1,0,0,0,641,643,3,106,53,0,642,
        635,1,0,0,0,643,646,1,0,0,0,644,642,1,0,0,0,644,645,1,0,0,0,645,
        71,1,0,0,0,646,644,1,0,0,0,647,658,3,74,37,0,648,650,5,99,0,0,649,
        648,1,0,0,0,649,650,1,0,0,0,650,651,1,0,0,0,651,653,5,68,0,0,652,
        654,5,99,0,0,653,652,1,0,0,0,653,654,1,0,0,0,654,655,1,0,0,0,655,
        657,3,74,37,0,656,649,1,0,0,0,657,660,1,0,0,0,658,656,1,0,0,0,658,
        659,1,0,0,0,659,73,1,0,0,0,660,658,1,0,0,0,661,672,3,76,38,0,662,
        664,5,99,0,0,663,662,1,0,0,0,663,664,1,0,0,0,664,665,1,0,0,0,665,
        667,5,70,0,0,666,668,5,99,0,0,667,666,1,0,0,0,667,668,1,0,0,0,668,
        669,1,0,0,0,669,671,3,76,38,0,670,663,1,0,0,0,671,674,1,0,0,0,672,
        670,1,0,0,0,672,673,1,0,0,0,673,75,1,0,0,0,674,672,1,0,0,0,675,686,
        3,78,39,0,676,678,5,99,0,0,677,676,1,0,0,0,677,678,1,0,0,0,678,679,
        1,0,0,0,679,681,5,60,0,0,680,682,5,99,0,0,681,680,1,0,0,0,681,682,
        1,0,0,0,682,683,1,0,0,0,683,685,3,78,39,0,684,677,1,0,0,0,685,688,
        1,0,0,0,686,684,1,0,0,0,686,687,1,0,0,0,687,77,1,0,0,0,688,686,1,
        0,0,0,689,691,5,67,0,0,690,692,5,99,0,0,691,690,1,0,0,0,691,692,
        1,0,0,0,692,694,1,0,0,0,693,689,1,0,0,0,694,697,1,0,0,0,695,693,
        1,0,0,0,695,696,1,0,0,0,696,698,1,0,0,0,697,695,1,0,0,0,698,699,
        3,80,40,0,699,79,1,0,0,0,700,712,3,84,42,0,701,703,5,99,0,0,702,
        701,1,0,0,0,702,703,1,0,0,0,703,704,1,0,0,0,704,706,3,82,41,0,705,
        707,5,99,0,0,706,705,1,0,0,0,706,707,1,0,0,0,707,708,1,0,0,0,708,
        709,3,84,42,0,709,711,1,0,0,0,710,702,1,0,0,0,711,714,1,0,0,0,712,
        710,1,0,0,0,712,713,1,0,0,0,713,81,1,0,0,0,714,712,1,0,0,0,715,716,
        7,3,0,0,716,83,1,0,0,0,717,728,3,86,43,0,718,720,5,99,0,0,719,718,
        1,0,0,0,719,720,1,0,0,0,720,721,1,0,0,0,721,723,7,4,0,0,722,724,
        5,99,0,0,723,722,1,0,0,0,723,724,1,0,0,0,724,725,1,0,0,0,725,727,
        3,86,43,0,726,719,1,0,0,0,727,730,1,0,0,0,728,726,1,0,0,0,728,729,
        1,0,0,0,729,85,1,0,0,0,730,728,1,0,0,0,731,742,3,88,44,0,732,734,
        5,99,0,0,733,732,1,0,0,0,733,734,1,0,0,0,734,735,1,0,0,0,735,737,
        7,5,0,0,736,738,5,99,0,0,737,736,1,0,0,0,737,738,1,0,0,0,738,739,
        1,0,0,0,739,741,3,88,44,0,740,733,1,0,0,0,741,744,1,0,0,0,742,740,
        1,0,0,0,742,743,1,0,0,0,743,87,1,0,0,0,744,742,1,0,0,0,745,756,3,
        90,45,0,746,748,5,99,0,0,747,746,1,0,0,0,747,748,1,0,0,0,748,749,
        1,0,0,0,749,751,5,22,0,0,750,752,5,99,0,0,751,750,1,0,0,0,751,752,
        1,0,0,0,752,753,1,0,0,0,753,755,3,90,45,0,754,747,1,0,0,0,755,758,
        1,0,0,0,756,754,1,0,0,0,756,757,1,0,0,0,757,89,1,0,0,0,758,756,1,
        0,0,0,759,761,7,4,0,0,760,759,1,0,0,0,760,761,1,0,0,0,761,763,1,
        0,0,0,762,764,5,99,0,0,763,762,1,0,0,0,763,764,1,0,0,0,764,765,1,
        0,0,0,765,766,3,92,46,0,766,91,1,0,0,0,767,778,3,102,51,0,768,770,
        5,99,0,0,769,768,1,0,0,0,769,770,1,0,0,0,770,774,1,0,0,0,771,775,
        3,96,48,0,772,775,3,94,47,0,773,775,3,100,50,0,774,771,1,0,0,0,774,
        772,1,0,0,0,774,773,1,0,0,0,775,777,1,0,0,0,776,769,1,0,0,0,777,
        780,1,0,0,0,778,776,1,0,0,0,778,779,1,0,0,0,779,93,1,0,0,0,780,778,
        1,0,0,0,781,783,5,99,0,0,782,781,1,0,0,0,782,783,1,0,0,0,783,784,
        1,0,0,0,784,786,5,65,0,0,785,787,5,99,0,0,786,785,1,0,0,0,786,787,
        1,0,0,0,787,788,1,0,0,0,788,814,3,102,51,0,789,791,5,16,0,0,790,
        792,5,99,0,0,791,790,1,0,0,0,791,792,1,0,0,0,792,807,1,0,0,0,793,
        795,3,72,36,0,794,793,1,0,0,0,794,795,1,0,0,0,795,797,1,0,0,0,796,
        798,5,99,0,0,797,796,1,0,0,0,797,798,1,0,0,0,798,799,1,0,0,0,799,
        801,5,8,0,0,800,802,5,99,0,0,801,800,1,0,0,0,801,802,1,0,0,0,802,
        804,1,0,0,0,803,805,3,72,36,0,804,803,1,0,0,0,804,805,1,0,0,0,805,
        808,1,0,0,0,806,808,3,72,36,0,807,794,1,0,0,0,807,806,1,0,0,0,808,
        810,1,0,0,0,809,811,5,99,0,0,810,809,1,0,0,0,810,811,1,0,0,0,811,
        812,1,0,0,0,812,814,5,17,0,0,813,782,1,0,0,0,813,789,1,0,0,0,814,
        95,1,0,0,0,815,817,3,98,49,0,816,818,5,99,0,0,817,816,1,0,0,0,817,
        818,1,0,0,0,818,819,1,0,0,0,819,820,3,102,51,0,820,97,1,0,0,0,821,
        823,5,69,0,0,822,824,5,99,0,0,823,822,1,0,0,0,823,824,1,0,0,0,824,
        825,1,0,0,0,825,833,5,57,0,0,826,828,5,64,0,0,827,829,5,99,0,0,828,
        827,1,0,0,0,828,829,1,0,0,0,829,830,1,0,0,0,830,833,5,57,0,0,831,
        833,5,62,0,0,832,821,1,0,0,0,832,826,1,0,0,0,832,831,1,0,0,0,833,
        99,1,0,0,0,834,836,5,99,0,0,835,834,1,0,0,0,835,836,1,0,0,0,836,
        837,1,0,0,0,837,839,5,66,0,0,838,840,5,99,0,0,839,838,1,0,0,0,839,
        840,1,0,0,0,840,842,1,0,0,0,841,843,5,67,0,0,842,841,1,0,0,0,842,
        843,1,0,0,0,843,845,1,0,0,0,844,846,5,99,0,0,845,844,1,0,0,0,845,
        846,1,0,0,0,846,847,1,0,0,0,847,848,5,73,0,0,848,101,1,0,0,0,849,
        854,3,104,52,0,850,852,5,99,0,0,851,850,1,0,0,0,851,852,1,0,0,0,
        852,853,1,0,0,0,853,855,3,62,31,0,854,851,1,0,0,0,854,855,1,0,0,
        0,855,103,1,0,0,0,856,867,3,116,58,0,857,859,5,99,0,0,858,857,1,
        0,0,0,858,859,1,0,0,0,859,860,1,0,0,0,860,862,5,10,0,0,861,863,5,
        99,0,0,862,861,1,0,0,0,862,863,1,0,0,0,863,864,1,0,0,0,864,866,3,
        172,86,0,865,858,1,0,0,0,866,869,1,0,0,0,867,865,1,0,0,0,867,868,
        1,0,0,0,868,105,1,0,0,0,869,867,1,0,0,0,870,872,3,174,87,0,871,873,
        5,99,0,0,872,871,1,0,0,0,872,873,1,0,0,0,873,874,1,0,0,0,874,876,
        5,1,0,0,875,877,5,99,0,0,876,875,1,0,0,0,876,877,1,0,0,0,877,879,
        1,0,0,0,878,870,1,0,0,0,878,879,1,0,0,0,879,880,1,0,0,0,880,881,
        3,108,54,0,881,107,1,0,0,0,882,889,3,114,57,0,883,885,5,99,0,0,884,
        883,1,0,0,0,884,885,1,0,0,0,885,886,1,0,0,0,886,888,3,110,55,0,887,
        884,1,0,0,0,888,891,1,0,0,0,889,887,1,0,0,0,889,890,1,0,0,0,890,
        904,1,0,0,0,891,889,1,0,0,0,892,894,5,12,0,0,893,895,5,99,0,0,894,
        893,1,0,0,0,894,895,1,0,0,0,895,896,1,0,0,0,896,898,3,108,54,0,897,
        899,5,99,0,0,898,897,1,0,0,0,898,899,1,0,0,0,899,900,1,0,0,0,900,
        901,5,13,0,0,901,904,1,0,0,0,902,904,3,134,67,0,903,882,1,0,0,0,
        903,892,1,0,0,0,903,902,1,0,0,0,904,109,1,0,0,0,905,907,3,120,60,
        0,906,908,5,99,0,0,907,906,1,0,0,0,907,908,1,0,0,0,908,909,1,0,0,
        0,909,910,3,114,57,0,910,111,1,0,0,0,911,914,3,168,84,0,912,914,
        3,154,77,0,913,911,1,0,0,0,913,912,1,0,0,0,914,113,1,0,0,0,915,917,
        5,12,0,0,916,918,5,99,0,0,917,916,1,0,0,0,917,918,1,0,0,0,918,920,
        1,0,0,0,919,921,3,174,87,0,920,919,1,0,0,0,920,921,1,0,0,0,921,923,
        1,0,0,0,922,924,5,99,0,0,923,922,1,0,0,0,923,924,1,0,0,0,924,926,
        1,0,0,0,925,927,3,62,31,0,926,925,1,0,0,0,926,927,1,0,0,0,927,929,
        1,0,0,0,928,930,5,99,0,0,929,928,1,0,0,0,929,930,1,0,0,0,930,932,
        1,0,0,0,931,933,3,112,56,0,932,931,1,0,0,0,932,933,1,0,0,0,933,935,
        1,0,0,0,934,936,5,99,0,0,935,934,1,0,0,0,935,936,1,0,0,0,936,937,
        1,0,0,0,937,938,5,13,0,0,938,115,1,0,0,0,939,952,3,156,78,0,940,
        952,3,154,77,0,941,952,3,152,76,0,942,952,3,148,74,0,943,952,3,144,
        72,0,944,952,3,140,70,0,945,952,3,138,69,0,946,952,3,142,71,0,947,
        952,3,136,68,0,948,952,3,134,67,0,949,952,3,174,87,0,950,952,3,130,
        65,0,951,939,1,0,0,0,951,940,1,0,0,0,951,941,1,0,0,0,951,942,1,0,
        0,0,951,943,1,0,0,0,951,944,1,0,0,0,951,945,1,0,0,0,951,946,1,0,
        0,0,951,947,1,0,0,0,951,948,1,0,0,0,951,949,1,0,0,0,951,950,1,0,
        0,0,952,117,1,0,0,0,953,954,3,174,87,0,954,955,5,1,0,0,955,119,1,
        0,0,0,956,958,5,6,0,0,957,959,5,99,0,0,958,957,1,0,0,0,958,959,1,
        0,0,0,959,960,1,0,0,0,960,962,5,18,0,0,961,963,5,99,0,0,962,961,
        1,0,0,0,962,963,1,0,0,0,963,965,1,0,0,0,964,966,3,122,61,0,965,964,
        1,0,0,0,965,966,1,0,0,0,966,968,1,0,0,0,967,969,5,99,0,0,968,967,
        1,0,0,0,968,969,1,0,0,0,969,970,1,0,0,0,970,972,5,18,0,0,971,973,
        5,99,0,0,972,971,1,0,0,0,972,973,1,0,0,0,973,975,1,0,0,0,974,976,
        5,5,0,0,975,974,1,0,0,0,975,976,1,0,0,0,976,995,1,0,0,0,977,979,
        5,18,0,0,978,980,5,99,0,0,979,978,1,0,0,0,979,980,1,0,0,0,980,982,
        1,0,0,0,981,983,3,122,61,0,982,981,1,0,0,0,982,983,1,0,0,0,983,985,
        1,0,0,0,984,986,5,99,0,0,985,984,1,0,0,0,985,986,1,0,0,0,986,987,
        1,0,0,0,987,989,5,18,0,0,988,990,5,99,0,0,989,988,1,0,0,0,989,990,
        1,0,0,0,990,992,1,0,0,0,991,993,5,5,0,0,992,991,1,0,0,0,992,993,
        1,0,0,0,993,995,1,0,0,0,994,956,1,0,0,0,994,977,1,0,0,0,995,121,
        1,0,0,0,996,998,5,16,0,0,997,999,5,99,0,0,998,997,1,0,0,0,998,999,
        1,0,0,0,999,1001,1,0,0,0,1000,1002,3,174,87,0,1001,1000,1,0,0,0,
        1001,1002,1,0,0,0,1002,1004,1,0,0,0,1003,1005,5,99,0,0,1004,1003,
        1,0,0,0,1004,1005,1,0,0,0,1005,1007,1,0,0,0,1006,1008,3,126,63,0,
        1007,1006,1,0,0,0,1007,1008,1,0,0,0,1008,1010,1,0,0,0,1009,1011,
        5,99,0,0,1010,1009,1,0,0,0,1010,1011,1,0,0,0,1011,1013,1,0,0,0,1012,
        1014,3,124,62,0,1013,1012,1,0,0,0,1013,1014,1,0,0,0,1014,1016,1,
        0,0,0,1015,1017,5,99,0,0,1016,1015,1,0,0,0,1016,1017,1,0,0,0,1017,
        1019,1,0,0,0,1018,1020,3,112,56,0,1019,1018,1,0,0,0,1019,1020,1,
        0,0,0,1020,1022,1,0,0,0,1021,1023,5,99,0,0,1022,1021,1,0,0,0,1022,
        1023,1,0,0,0,1023,1024,1,0,0,0,1024,1025,5,17,0,0,1025,123,1,0,0,
        0,1026,1028,5,23,0,0,1027,1029,5,99,0,0,1028,1027,1,0,0,0,1028,1029,
        1,0,0,0,1029,1031,1,0,0,0,1030,1032,5,92,0,0,1031,1030,1,0,0,0,1031,
        1032,1,0,0,0,1032,1043,1,0,0,0,1033,1035,5,99,0,0,1034,1033,1,0,
        0,0,1034,1035,1,0,0,0,1035,1036,1,0,0,0,1036,1038,5,8,0,0,1037,1039,
        5,99,0,0,1038,1037,1,0,0,0,1038,1039,1,0,0,0,1039,1041,1,0,0,0,1040,
        1042,5,92,0,0,1041,1040,1,0,0,0,1041,1042,1,0,0,0,1042,1044,1,0,
        0,0,1043,1034,1,0,0,0,1043,1044,1,0,0,0,1044,125,1,0,0,0,1045,1047,
        5,25,0,0,1046,1048,5,99,0,0,1047,1046,1,0,0,0,1047,1048,1,0,0,0,
        1048,1049,1,0,0,0,1049,1066,3,172,86,0,1050,1052,5,99,0,0,1051,1050,
        1,0,0,0,1051,1052,1,0,0,0,1052,1053,1,0,0,0,1053,1055,5,26,0,0,1054,
        1056,5,99,0,0,1055,1054,1,0,0,0,1055,1056,1,0,0,0,1056,1058,1,0,
        0,0,1057,1059,5,25,0,0,1058,1057,1,0,0,0,1058,1059,1,0,0,0,1059,
        1061,1,0,0,0,1060,1062,5,99,0,0,1061,1060,1,0,0,0,1061,1062,1,0,
        0,0,1062,1063,1,0,0,0,1063,1065,3,172,86,0,1064,1051,1,0,0,0,1065,
        1068,1,0,0,0,1066,1064,1,0,0,0,1066,1067,1,0,0,0,1067,127,1,0,0,
        0,1068,1066,1,0,0,0,1069,1071,5,58,0,0,1070,1072,5,99,0,0,1071,1070,
        1,0,0,0,1071,1072,1,0,0,0,1072,1074,1,0,0,0,1073,1075,5,36,0,0,1074,
        1073,1,0,0,0,1074,1075,1,0,0,0,1075,1077,1,0,0,0,1076,1078,5,99,
        0,0,1077,1076,1,0,0,0,1077,1078,1,0,0,0,1078,1079,1,0,0,0,1079,1080,
        3,6,3,0,1080,129,1,0,0,0,1081,1083,5,45,0,0,1082,1084,5,99,0,0,1083,
        1082,1,0,0,0,1083,1084,1,0,0,0,1084,1085,1,0,0,0,1085,1087,5,14,
        0,0,1086,1088,5,99,0,0,1087,1086,1,0,0,0,1087,1088,1,0,0,0,1088,
        1091,1,0,0,0,1089,1092,3,4,2,0,1090,1092,3,66,33,0,1091,1089,1,0,
        0,0,1091,1090,1,0,0,0,1092,1094,1,0,0,0,1093,1095,5,99,0,0,1094,
        1093,1,0,0,0,1094,1095,1,0,0,0,1095,1096,1,0,0,0,1096,1097,5,15,
        0,0,1097,131,1,0,0,0,1098,1109,3,174,87,0,1099,1101,5,99,0,0,1100,
        1099,1,0,0,0,1100,1101,1,0,0,0,1101,1102,1,0,0,0,1102,1104,5,10,
        0,0,1103,1105,5,99,0,0,1104,1103,1,0,0,0,1104,1105,1,0,0,0,1105,
        1106,1,0,0,0,1106,1108,3,174,87,0,1107,1100,1,0,0,0,1108,1111,1,
        0,0,0,1109,1107,1,0,0,0,1109,1110,1,0,0,0,1110,133,1,0,0,0,1111,
        1109,1,0,0,0,1112,1114,3,132,66,0,1113,1115,5,99,0,0,1114,1113,1,
        0,0,0,1114,1115,1,0,0,0,1115,1116,1,0,0,0,1116,1118,5,12,0,0,1117,
        1119,5,99,0,0,1118,1117,1,0,0,0,1118,1119,1,0,0,0,1119,1124,1,0,
        0,0,1120,1122,5,63,0,0,1121,1123,5,99,0,0,1122,1121,1,0,0,0,1122,
        1123,1,0,0,0,1123,1125,1,0,0,0,1124,1120,1,0,0,0,1124,1125,1,0,0,
        0,1125,1126,1,0,0,0,1126,1128,3,108,54,0,1127,1129,5,99,0,0,1128,
        1127,1,0,0,0,1128,1129,1,0,0,0,1129,1130,1,0,0,0,1130,1131,5,13,
        0,0,1131,1155,1,0,0,0,1132,1134,3,132,66,0,1133,1135,5,99,0,0,1134,
        1133,1,0,0,0,1134,1135,1,0,0,0,1135,1136,1,0,0,0,1136,1138,5,12,
        0,0,1137,1139,5,99,0,0,1138,1137,1,0,0,0,1138,1139,1,0,0,0,1139,
        1144,1,0,0,0,1140,1142,5,63,0,0,1141,1143,5,99,0,0,1142,1141,1,0,
        0,0,1142,1143,1,0,0,0,1143,1145,1,0,0,0,1144,1140,1,0,0,0,1144,1145,
        1,0,0,0,1145,1147,1,0,0,0,1146,1148,3,150,75,0,1147,1146,1,0,0,0,
        1147,1148,1,0,0,0,1148,1150,1,0,0,0,1149,1151,5,99,0,0,1150,1149,
        1,0,0,0,1150,1151,1,0,0,0,1151,1152,1,0,0,0,1152,1153,5,13,0,0,1153,
        1155,1,0,0,0,1154,1112,1,0,0,0,1154,1132,1,0,0,0,1155,135,1,0,0,
        0,1156,1158,5,12,0,0,1157,1159,5,99,0,0,1158,1157,1,0,0,0,1158,1159,
        1,0,0,0,1159,1160,1,0,0,0,1160,1162,3,72,36,0,1161,1163,5,99,0,0,
        1162,1161,1,0,0,0,1162,1163,1,0,0,0,1163,1164,1,0,0,0,1164,1165,
        5,13,0,0,1165,137,1,0,0,0,1166,1168,7,6,0,0,1167,1169,5,99,0,0,1168,
        1167,1,0,0,0,1168,1169,1,0,0,0,1169,1170,1,0,0,0,1170,1172,5,12,
        0,0,1171,1173,5,99,0,0,1172,1171,1,0,0,0,1172,1173,1,0,0,0,1173,
        1174,1,0,0,0,1174,1176,3,146,73,0,1175,1177,5,99,0,0,1176,1175,1,
        0,0,0,1176,1177,1,0,0,0,1177,1178,1,0,0,0,1178,1179,5,13,0,0,1179,
        139,1,0,0,0,1180,1182,5,16,0,0,1181,1183,5,99,0,0,1182,1181,1,0,
        0,0,1182,1183,1,0,0,0,1183,1192,1,0,0,0,1184,1186,3,118,59,0,1185,
        1187,5,99,0,0,1186,1185,1,0,0,0,1186,1187,1,0,0,0,1187,1188,1,0,
        0,0,1188,1190,5,1,0,0,1189,1191,5,99,0,0,1190,1189,1,0,0,0,1190,
        1191,1,0,0,0,1191,1193,1,0,0,0,1192,1184,1,0,0,0,1192,1193,1,0,0,
        0,1193,1194,1,0,0,0,1194,1199,3,142,71,0,1195,1197,5,99,0,0,1196,
        1195,1,0,0,0,1196,1197,1,0,0,0,1197,1198,1,0,0,0,1198,1200,3,68,
        34,0,1199,1196,1,0,0,0,1199,1200,1,0,0,0,1200,1202,1,0,0,0,1201,
        1203,5,99,0,0,1202,1201,1,0,0,0,1202,1203,1,0,0,0,1203,1204,1,0,
        0,0,1204,1206,5,26,0,0,1205,1207,5,99,0,0,1206,1205,1,0,0,0,1206,
        1207,1,0,0,0,1207,1208,1,0,0,0,1208,1210,3,72,36,0,1209,1211,5,99,
        0,0,1210,1209,1,0,0,0,1210,1211,1,0,0,0,1211,1212,1,0,0,0,1212,1213,
        5,17,0,0,1213,141,1,0,0,0,1214,1219,3,114,57,0,1215,1217,5,99,0,
        0,1216,1215,1,0,0,0,1216,1217,1,0,0,0,1217,1218,1,0,0,0,1218,1220,
        3,110,55,0,1219,1216,1,0,0,0,1220,1221,1,0,0,0,1221,1219,1,0,0,0,
        1221,1222,1,0,0,0,1222,143,1,0,0,0,1223,1225,5,16,0,0,1224,1226,
        5,99,0,0,1225,1224,1,0,0,0,1225,1226,1,0,0,0,1226,1227,1,0,0,0,1227,
        1236,3,146,73,0,1228,1230,5,99,0,0,1229,1228,1,0,0,0,1229,1230,1,
        0,0,0,1230,1231,1,0,0,0,1231,1233,5,26,0,0,1232,1234,5,99,0,0,1233,
        1232,1,0,0,0,1233,1234,1,0,0,0,1234,1235,1,0,0,0,1235,1237,3,72,
        36,0,1236,1229,1,0,0,0,1236,1237,1,0,0,0,1237,1239,1,0,0,0,1238,
        1240,5,99,0,0,1239,1238,1,0,0,0,1239,1240,1,0,0,0,1240,1241,1,0,
        0,0,1241,1242,5,17,0,0,1242,145,1,0,0,0,1243,1245,3,174,87,0,1244,
        1246,5,99,0,0,1245,1244,1,0,0,0,1245,1246,1,0,0,0,1246,1247,1,0,
        0,0,1247,1249,5,65,0,0,1248,1250,5,99,0,0,1249,1248,1,0,0,0,1249,
        1250,1,0,0,0,1250,1251,1,0,0,0,1251,1256,3,72,36,0,1252,1254,5,99,
        0,0,1253,1252,1,0,0,0,1253,1254,1,0,0,0,1254,1255,1,0,0,0,1255,1257,
        3,68,34,0,1256,1253,1,0,0,0,1256,1257,1,0,0,0,1257,147,1,0,0,0,1258,
        1260,5,32,0,0,1259,1261,5,99,0,0,1260,1259,1,0,0,0,1260,1261,1,0,
        0,0,1261,1262,1,0,0,0,1262,1264,5,12,0,0,1263,1265,5,99,0,0,1264,
        1263,1,0,0,0,1264,1265,1,0,0,0,1265,1266,1,0,0,0,1266,1268,5,23,
        0,0,1267,1269,5,99,0,0,1268,1267,1,0,0,0,1268,1269,1,0,0,0,1269,
        1270,1,0,0,0,1270,1271,5,13,0,0,1271,149,1,0,0,0,1272,1283,3,72,
        36,0,1273,1275,5,99,0,0,1274,1273,1,0,0,0,1274,1275,1,0,0,0,1275,
        1276,1,0,0,0,1276,1278,5,11,0,0,1277,1279,5,99,0,0,1278,1277,1,0,
        0,0,1278,1279,1,0,0,0,1279,1280,1,0,0,0,1280,1282,3,72,36,0,1281,
        1274,1,0,0,0,1282,1285,1,0,0,0,1283,1281,1,0,0,0,1283,1284,1,0,0,
        0,1284,151,1,0,0,0,1285,1283,1,0,0,0,1286,1288,5,79,0,0,1287,1289,
        5,99,0,0,1288,1287,1,0,0,0,1288,1289,1,0,0,0,1289,1291,1,0,0,0,1290,
        1292,3,72,36,0,1291,1290,1,0,0,0,1291,1292,1,0,0,0,1292,1310,1,0,
        0,0,1293,1295,5,99,0,0,1294,1293,1,0,0,0,1294,1295,1,0,0,0,1295,
        1296,1,0,0,0,1296,1298,5,80,0,0,1297,1299,5,99,0,0,1298,1297,1,0,
        0,0,1298,1299,1,0,0,0,1299,1300,1,0,0,0,1300,1302,3,72,36,0,1301,
        1303,5,99,0,0,1302,1301,1,0,0,0,1302,1303,1,0,0,0,1303,1304,1,0,
        0,0,1304,1306,5,81,0,0,1305,1307,5,99,0,0,1306,1305,1,0,0,0,1306,
        1307,1,0,0,0,1307,1308,1,0,0,0,1308,1309,3,72,36,0,1309,1311,1,0,
        0,0,1310,1294,1,0,0,0,1311,1312,1,0,0,0,1312,1310,1,0,0,0,1312,1313,
        1,0,0,0,1313,1322,1,0,0,0,1314,1316,5,99,0,0,1315,1314,1,0,0,0,1315,
        1316,1,0,0,0,1316,1317,1,0,0,0,1317,1319,5,82,0,0,1318,1320,5,99,
        0,0,1319,1318,1,0,0,0,1319,1320,1,0,0,0,1320,1321,1,0,0,0,1321,1323,
        3,72,36,0,1322,1315,1,0,0,0,1322,1323,1,0,0,0,1323,1325,1,0,0,0,
        1324,1326,5,99,0,0,1325,1324,1,0,0,0,1325,1326,1,0,0,0,1326,1327,
        1,0,0,0,1327,1328,5,83,0,0,1328,153,1,0,0,0,1329,1332,5,27,0,0,1330,
        1333,3,174,87,0,1331,1333,3,160,80,0,1332,1330,1,0,0,0,1332,1331,
        1,0,0,0,1333,155,1,0,0,0,1334,1342,3,158,79,0,1335,1342,3,160,80,
        0,1336,1342,5,73,0,0,1337,1342,3,162,81,0,1338,1342,3,164,82,0,1339,
        1342,3,166,83,0,1340,1342,3,168,84,0,1341,1334,1,0,0,0,1341,1335,
        1,0,0,0,1341,1336,1,0,0,0,1341,1337,1,0,0,0,1341,1338,1,0,0,0,1341,
        1339,1,0,0,0,1341,1340,1,0,0,0,1342,157,1,0,0,0,1343,1344,7,7,0,
        0,1344,159,1,0,0,0,1345,1346,5,93,0,0,1346,161,1,0,0,0,1347,1348,
        5,91,0,0,1348,163,1,0,0,0,1349,1350,5,90,0,0,1350,165,1,0,0,0,1351,
        1353,5,16,0,0,1352,1354,5,99,0,0,1353,1352,1,0,0,0,1353,1354,1,0,
        0,0,1354,1356,1,0,0,0,1355,1357,3,150,75,0,1356,1355,1,0,0,0,1356,
        1357,1,0,0,0,1357,1359,1,0,0,0,1358,1360,5,99,0,0,1359,1358,1,0,
        0,0,1359,1360,1,0,0,0,1360,1361,1,0,0,0,1361,1362,5,17,0,0,1362,
        167,1,0,0,0,1363,1365,5,14,0,0,1364,1366,5,99,0,0,1365,1364,1,0,
        0,0,1365,1366,1,0,0,0,1366,1381,1,0,0,0,1367,1378,3,170,85,0,1368,
        1370,5,99,0,0,1369,1368,1,0,0,0,1369,1370,1,0,0,0,1370,1371,1,0,
        0,0,1371,1373,5,11,0,0,1372,1374,5,99,0,0,1373,1372,1,0,0,0,1373,
        1374,1,0,0,0,1374,1375,1,0,0,0,1375,1377,3,170,85,0,1376,1369,1,
        0,0,0,1377,1380,1,0,0,0,1378,1376,1,0,0,0,1378,1379,1,0,0,0,1379,
        1382,1,0,0,0,1380,1378,1,0,0,0,1381,1367,1,0,0,0,1381,1382,1,0,0,
        0,1382,1384,1,0,0,0,1383,1385,5,99,0,0,1384,1383,1,0,0,0,1384,1385,
        1,0,0,0,1385,1386,1,0,0,0,1386,1387,5,15,0,0,1387,169,1,0,0,0,1388,
        1390,3,172,86,0,1389,1391,5,99,0,0,1390,1389,1,0,0,0,1390,1391,1,
        0,0,0,1391,1392,1,0,0,0,1392,1394,5,25,0,0,1393,1395,5,99,0,0,1394,
        1393,1,0,0,0,1394,1395,1,0,0,0,1395,1396,1,0,0,0,1396,1397,3,72,
        36,0,1397,171,1,0,0,0,1398,1401,3,174,87,0,1399,1401,3,176,88,0,
        1400,1398,1,0,0,0,1400,1399,1,0,0,0,1401,173,1,0,0,0,1402,1403,7,
        8,0,0,1403,175,1,0,0,0,1404,1405,7,9,0,0,1405,177,1,0,0,0,291,179,
        183,186,189,195,199,204,209,213,217,220,223,227,231,233,237,243,
        247,250,254,260,265,268,271,275,278,281,284,287,290,294,297,301,
        306,311,315,318,322,325,329,333,337,341,346,351,355,361,365,368,
        371,373,377,381,386,390,395,401,405,411,415,419,426,433,437,441,
        447,451,455,460,465,470,474,478,482,486,489,493,496,499,505,509,
        514,518,521,525,529,531,537,541,546,551,555,561,565,569,574,579,
        583,589,593,599,603,607,612,616,622,625,629,635,639,644,649,653,
        658,663,667,672,677,681,686,691,695,702,706,712,719,723,728,733,
        737,742,747,751,756,760,763,769,774,778,782,786,791,794,797,801,
        804,807,810,813,817,823,828,832,835,839,842,845,851,854,858,862,
        867,872,876,878,884,889,894,898,903,907,913,917,920,923,926,929,
        932,935,951,958,962,965,968,972,975,979,982,985,989,992,994,998,
        1001,1004,1007,1010,1013,1016,1019,1022,1028,1031,1034,1038,1041,
        1043,1047,1051,1055,1058,1061,1066,1071,1074,1077,1083,1087,1091,
        1094,1100,1104,1109,1114,1118,1122,1124,1128,1134,1138,1142,1144,
        1147,1150,1154,1158,1162,1168,1172,1176,1182,1186,1190,1192,1196,
        1199,1202,1206,1210,1216,1221,1225,1229,1233,1236,1239,1245,1249,
        1253,1256,1260,1264,1268,1274,1278,1283,1288,1291,1294,1298,1302,
        1306,1312,1315,1319,1322,1325,1332,1341,1353,1356,1359,1365,1369,
        1373,1378,1381,1384,1390,1394,1400
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
