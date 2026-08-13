
import { ErrorNode, ParseTreeListener, ParserRuleContext, TerminalNode } from "antlr4ng";


import { ScriptContext } from "./CypherParser.js";
import { QueryContext } from "./CypherParser.js";
import { RegularQueryContext } from "./CypherParser.js";
import { SingleQueryContext } from "./CypherParser.js";
import { StandaloneCallContext } from "./CypherParser.js";
import { ReturnStContext } from "./CypherParser.js";
import { WithStContext } from "./CypherParser.js";
import { SkipStContext } from "./CypherParser.js";
import { LimitStContext } from "./CypherParser.js";
import { ProjectionBodyContext } from "./CypherParser.js";
import { ProjectionItemsContext } from "./CypherParser.js";
import { ProjectionItemContext } from "./CypherParser.js";
import { OrderItemContext } from "./CypherParser.js";
import { OrderStContext } from "./CypherParser.js";
import { SinglePartQContext } from "./CypherParser.js";
import { MultiPartQContext } from "./CypherParser.js";
import { MatchStContext } from "./CypherParser.js";
import { UnwindStContext } from "./CypherParser.js";
import { ReadingStatementContext } from "./CypherParser.js";
import { UpdatingStatementContext } from "./CypherParser.js";
import { DeleteStContext } from "./CypherParser.js";
import { RemoveStContext } from "./CypherParser.js";
import { RemoveItemContext } from "./CypherParser.js";
import { QueryCallStContext } from "./CypherParser.js";
import { ParenExpressionChainContext } from "./CypherParser.js";
import { YieldItemsContext } from "./CypherParser.js";
import { YieldItemContext } from "./CypherParser.js";
import { MergeStContext } from "./CypherParser.js";
import { MergeActionContext } from "./CypherParser.js";
import { SetStContext } from "./CypherParser.js";
import { SetItemContext } from "./CypherParser.js";
import { NodeLabelsContext } from "./CypherParser.js";
import { CreateStContext } from "./CypherParser.js";
import { PatternWhereContext } from "./CypherParser.js";
import { WhereContext } from "./CypherParser.js";
import { PatternContext } from "./CypherParser.js";
import { ExpressionContext } from "./CypherParser.js";
import { XorExpressionContext } from "./CypherParser.js";
import { AndExpressionContext } from "./CypherParser.js";
import { NotExpressionContext } from "./CypherParser.js";
import { ComparisonExpressionContext } from "./CypherParser.js";
import { ComparisonSignsContext } from "./CypherParser.js";
import { AddSubExpressionContext } from "./CypherParser.js";
import { MultDivExpressionContext } from "./CypherParser.js";
import { PowerExpressionContext } from "./CypherParser.js";
import { UnaryAddSubExpressionContext } from "./CypherParser.js";
import { AtomicExpressionContext } from "./CypherParser.js";
import { ListExpressionContext } from "./CypherParser.js";
import { StringExpressionContext } from "./CypherParser.js";
import { StringExpPrefixContext } from "./CypherParser.js";
import { NullExpressionContext } from "./CypherParser.js";
import { PropertyOrLabelExpressionContext } from "./CypherParser.js";
import { PropertyExpressionContext } from "./CypherParser.js";
import { PatternPartContext } from "./CypherParser.js";
import { PatternElemContext } from "./CypherParser.js";
import { PatternElemChainContext } from "./CypherParser.js";
import { PropertiesContext } from "./CypherParser.js";
import { NodePatternContext } from "./CypherParser.js";
import { AtomContext } from "./CypherParser.js";
import { LhsContext } from "./CypherParser.js";
import { RelationshipPatternContext } from "./CypherParser.js";
import { RelationDetailContext } from "./CypherParser.js";
import { RangeLitContext } from "./CypherParser.js";
import { RelationshipTypesContext } from "./CypherParser.js";
import { UnionStContext } from "./CypherParser.js";
import { SubqueryExistContext } from "./CypherParser.js";
import { InvocationNameContext } from "./CypherParser.js";
import { FunctionInvocationContext } from "./CypherParser.js";
import { ParenthesizedExpressionContext } from "./CypherParser.js";
import { FilterWithContext } from "./CypherParser.js";
import { PatternComprehensionContext } from "./CypherParser.js";
import { RelationshipsChainPatternContext } from "./CypherParser.js";
import { ListComprehensionContext } from "./CypherParser.js";
import { FilterExpressionContext } from "./CypherParser.js";
import { CountAllContext } from "./CypherParser.js";
import { ExpressionChainContext } from "./CypherParser.js";
import { CaseExpressionContext } from "./CypherParser.js";
import { ParameterContext } from "./CypherParser.js";
import { LiteralContext } from "./CypherParser.js";
import { BoolLitContext } from "./CypherParser.js";
import { NumLitContext } from "./CypherParser.js";
import { StringLitContext } from "./CypherParser.js";
import { CharLitContext } from "./CypherParser.js";
import { ListLitContext } from "./CypherParser.js";
import { MapLitContext } from "./CypherParser.js";
import { MapPairContext } from "./CypherParser.js";
import { NameContext } from "./CypherParser.js";
import { SymbolContext } from "./CypherParser.js";
import { ReservedWordContext } from "./CypherParser.js";


/**
 * This interface defines a complete listener for a parse tree produced by
 * `CypherParser`.
 */
export class CypherParserListener implements ParseTreeListener {
    /**
     * Enter a parse tree produced by `CypherParser.script`.
     * @param ctx the parse tree
     */
    enterScript?: (ctx: ScriptContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.script`.
     * @param ctx the parse tree
     */
    exitScript?: (ctx: ScriptContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.query`.
     * @param ctx the parse tree
     */
    enterQuery?: (ctx: QueryContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.query`.
     * @param ctx the parse tree
     */
    exitQuery?: (ctx: QueryContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.regularQuery`.
     * @param ctx the parse tree
     */
    enterRegularQuery?: (ctx: RegularQueryContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.regularQuery`.
     * @param ctx the parse tree
     */
    exitRegularQuery?: (ctx: RegularQueryContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.singleQuery`.
     * @param ctx the parse tree
     */
    enterSingleQuery?: (ctx: SingleQueryContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.singleQuery`.
     * @param ctx the parse tree
     */
    exitSingleQuery?: (ctx: SingleQueryContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.standaloneCall`.
     * @param ctx the parse tree
     */
    enterStandaloneCall?: (ctx: StandaloneCallContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.standaloneCall`.
     * @param ctx the parse tree
     */
    exitStandaloneCall?: (ctx: StandaloneCallContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.returnSt`.
     * @param ctx the parse tree
     */
    enterReturnSt?: (ctx: ReturnStContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.returnSt`.
     * @param ctx the parse tree
     */
    exitReturnSt?: (ctx: ReturnStContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.withSt`.
     * @param ctx the parse tree
     */
    enterWithSt?: (ctx: WithStContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.withSt`.
     * @param ctx the parse tree
     */
    exitWithSt?: (ctx: WithStContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.skipSt`.
     * @param ctx the parse tree
     */
    enterSkipSt?: (ctx: SkipStContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.skipSt`.
     * @param ctx the parse tree
     */
    exitSkipSt?: (ctx: SkipStContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.limitSt`.
     * @param ctx the parse tree
     */
    enterLimitSt?: (ctx: LimitStContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.limitSt`.
     * @param ctx the parse tree
     */
    exitLimitSt?: (ctx: LimitStContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.projectionBody`.
     * @param ctx the parse tree
     */
    enterProjectionBody?: (ctx: ProjectionBodyContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.projectionBody`.
     * @param ctx the parse tree
     */
    exitProjectionBody?: (ctx: ProjectionBodyContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.projectionItems`.
     * @param ctx the parse tree
     */
    enterProjectionItems?: (ctx: ProjectionItemsContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.projectionItems`.
     * @param ctx the parse tree
     */
    exitProjectionItems?: (ctx: ProjectionItemsContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.projectionItem`.
     * @param ctx the parse tree
     */
    enterProjectionItem?: (ctx: ProjectionItemContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.projectionItem`.
     * @param ctx the parse tree
     */
    exitProjectionItem?: (ctx: ProjectionItemContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.orderItem`.
     * @param ctx the parse tree
     */
    enterOrderItem?: (ctx: OrderItemContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.orderItem`.
     * @param ctx the parse tree
     */
    exitOrderItem?: (ctx: OrderItemContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.orderSt`.
     * @param ctx the parse tree
     */
    enterOrderSt?: (ctx: OrderStContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.orderSt`.
     * @param ctx the parse tree
     */
    exitOrderSt?: (ctx: OrderStContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.singlePartQ`.
     * @param ctx the parse tree
     */
    enterSinglePartQ?: (ctx: SinglePartQContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.singlePartQ`.
     * @param ctx the parse tree
     */
    exitSinglePartQ?: (ctx: SinglePartQContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.multiPartQ`.
     * @param ctx the parse tree
     */
    enterMultiPartQ?: (ctx: MultiPartQContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.multiPartQ`.
     * @param ctx the parse tree
     */
    exitMultiPartQ?: (ctx: MultiPartQContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.matchSt`.
     * @param ctx the parse tree
     */
    enterMatchSt?: (ctx: MatchStContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.matchSt`.
     * @param ctx the parse tree
     */
    exitMatchSt?: (ctx: MatchStContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.unwindSt`.
     * @param ctx the parse tree
     */
    enterUnwindSt?: (ctx: UnwindStContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.unwindSt`.
     * @param ctx the parse tree
     */
    exitUnwindSt?: (ctx: UnwindStContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.readingStatement`.
     * @param ctx the parse tree
     */
    enterReadingStatement?: (ctx: ReadingStatementContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.readingStatement`.
     * @param ctx the parse tree
     */
    exitReadingStatement?: (ctx: ReadingStatementContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.updatingStatement`.
     * @param ctx the parse tree
     */
    enterUpdatingStatement?: (ctx: UpdatingStatementContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.updatingStatement`.
     * @param ctx the parse tree
     */
    exitUpdatingStatement?: (ctx: UpdatingStatementContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.deleteSt`.
     * @param ctx the parse tree
     */
    enterDeleteSt?: (ctx: DeleteStContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.deleteSt`.
     * @param ctx the parse tree
     */
    exitDeleteSt?: (ctx: DeleteStContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.removeSt`.
     * @param ctx the parse tree
     */
    enterRemoveSt?: (ctx: RemoveStContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.removeSt`.
     * @param ctx the parse tree
     */
    exitRemoveSt?: (ctx: RemoveStContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.removeItem`.
     * @param ctx the parse tree
     */
    enterRemoveItem?: (ctx: RemoveItemContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.removeItem`.
     * @param ctx the parse tree
     */
    exitRemoveItem?: (ctx: RemoveItemContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.queryCallSt`.
     * @param ctx the parse tree
     */
    enterQueryCallSt?: (ctx: QueryCallStContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.queryCallSt`.
     * @param ctx the parse tree
     */
    exitQueryCallSt?: (ctx: QueryCallStContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.parenExpressionChain`.
     * @param ctx the parse tree
     */
    enterParenExpressionChain?: (ctx: ParenExpressionChainContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.parenExpressionChain`.
     * @param ctx the parse tree
     */
    exitParenExpressionChain?: (ctx: ParenExpressionChainContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.yieldItems`.
     * @param ctx the parse tree
     */
    enterYieldItems?: (ctx: YieldItemsContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.yieldItems`.
     * @param ctx the parse tree
     */
    exitYieldItems?: (ctx: YieldItemsContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.yieldItem`.
     * @param ctx the parse tree
     */
    enterYieldItem?: (ctx: YieldItemContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.yieldItem`.
     * @param ctx the parse tree
     */
    exitYieldItem?: (ctx: YieldItemContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.mergeSt`.
     * @param ctx the parse tree
     */
    enterMergeSt?: (ctx: MergeStContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.mergeSt`.
     * @param ctx the parse tree
     */
    exitMergeSt?: (ctx: MergeStContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.mergeAction`.
     * @param ctx the parse tree
     */
    enterMergeAction?: (ctx: MergeActionContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.mergeAction`.
     * @param ctx the parse tree
     */
    exitMergeAction?: (ctx: MergeActionContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.setSt`.
     * @param ctx the parse tree
     */
    enterSetSt?: (ctx: SetStContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.setSt`.
     * @param ctx the parse tree
     */
    exitSetSt?: (ctx: SetStContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.setItem`.
     * @param ctx the parse tree
     */
    enterSetItem?: (ctx: SetItemContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.setItem`.
     * @param ctx the parse tree
     */
    exitSetItem?: (ctx: SetItemContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.nodeLabels`.
     * @param ctx the parse tree
     */
    enterNodeLabels?: (ctx: NodeLabelsContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.nodeLabels`.
     * @param ctx the parse tree
     */
    exitNodeLabels?: (ctx: NodeLabelsContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.createSt`.
     * @param ctx the parse tree
     */
    enterCreateSt?: (ctx: CreateStContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.createSt`.
     * @param ctx the parse tree
     */
    exitCreateSt?: (ctx: CreateStContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.patternWhere`.
     * @param ctx the parse tree
     */
    enterPatternWhere?: (ctx: PatternWhereContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.patternWhere`.
     * @param ctx the parse tree
     */
    exitPatternWhere?: (ctx: PatternWhereContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.where`.
     * @param ctx the parse tree
     */
    enterWhere?: (ctx: WhereContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.where`.
     * @param ctx the parse tree
     */
    exitWhere?: (ctx: WhereContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.pattern`.
     * @param ctx the parse tree
     */
    enterPattern?: (ctx: PatternContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.pattern`.
     * @param ctx the parse tree
     */
    exitPattern?: (ctx: PatternContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.expression`.
     * @param ctx the parse tree
     */
    enterExpression?: (ctx: ExpressionContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.expression`.
     * @param ctx the parse tree
     */
    exitExpression?: (ctx: ExpressionContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.xorExpression`.
     * @param ctx the parse tree
     */
    enterXorExpression?: (ctx: XorExpressionContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.xorExpression`.
     * @param ctx the parse tree
     */
    exitXorExpression?: (ctx: XorExpressionContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.andExpression`.
     * @param ctx the parse tree
     */
    enterAndExpression?: (ctx: AndExpressionContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.andExpression`.
     * @param ctx the parse tree
     */
    exitAndExpression?: (ctx: AndExpressionContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.notExpression`.
     * @param ctx the parse tree
     */
    enterNotExpression?: (ctx: NotExpressionContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.notExpression`.
     * @param ctx the parse tree
     */
    exitNotExpression?: (ctx: NotExpressionContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.comparisonExpression`.
     * @param ctx the parse tree
     */
    enterComparisonExpression?: (ctx: ComparisonExpressionContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.comparisonExpression`.
     * @param ctx the parse tree
     */
    exitComparisonExpression?: (ctx: ComparisonExpressionContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.comparisonSigns`.
     * @param ctx the parse tree
     */
    enterComparisonSigns?: (ctx: ComparisonSignsContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.comparisonSigns`.
     * @param ctx the parse tree
     */
    exitComparisonSigns?: (ctx: ComparisonSignsContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.addSubExpression`.
     * @param ctx the parse tree
     */
    enterAddSubExpression?: (ctx: AddSubExpressionContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.addSubExpression`.
     * @param ctx the parse tree
     */
    exitAddSubExpression?: (ctx: AddSubExpressionContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.multDivExpression`.
     * @param ctx the parse tree
     */
    enterMultDivExpression?: (ctx: MultDivExpressionContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.multDivExpression`.
     * @param ctx the parse tree
     */
    exitMultDivExpression?: (ctx: MultDivExpressionContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.powerExpression`.
     * @param ctx the parse tree
     */
    enterPowerExpression?: (ctx: PowerExpressionContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.powerExpression`.
     * @param ctx the parse tree
     */
    exitPowerExpression?: (ctx: PowerExpressionContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.unaryAddSubExpression`.
     * @param ctx the parse tree
     */
    enterUnaryAddSubExpression?: (ctx: UnaryAddSubExpressionContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.unaryAddSubExpression`.
     * @param ctx the parse tree
     */
    exitUnaryAddSubExpression?: (ctx: UnaryAddSubExpressionContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.atomicExpression`.
     * @param ctx the parse tree
     */
    enterAtomicExpression?: (ctx: AtomicExpressionContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.atomicExpression`.
     * @param ctx the parse tree
     */
    exitAtomicExpression?: (ctx: AtomicExpressionContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.listExpression`.
     * @param ctx the parse tree
     */
    enterListExpression?: (ctx: ListExpressionContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.listExpression`.
     * @param ctx the parse tree
     */
    exitListExpression?: (ctx: ListExpressionContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.stringExpression`.
     * @param ctx the parse tree
     */
    enterStringExpression?: (ctx: StringExpressionContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.stringExpression`.
     * @param ctx the parse tree
     */
    exitStringExpression?: (ctx: StringExpressionContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.stringExpPrefix`.
     * @param ctx the parse tree
     */
    enterStringExpPrefix?: (ctx: StringExpPrefixContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.stringExpPrefix`.
     * @param ctx the parse tree
     */
    exitStringExpPrefix?: (ctx: StringExpPrefixContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.nullExpression`.
     * @param ctx the parse tree
     */
    enterNullExpression?: (ctx: NullExpressionContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.nullExpression`.
     * @param ctx the parse tree
     */
    exitNullExpression?: (ctx: NullExpressionContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.propertyOrLabelExpression`.
     * @param ctx the parse tree
     */
    enterPropertyOrLabelExpression?: (ctx: PropertyOrLabelExpressionContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.propertyOrLabelExpression`.
     * @param ctx the parse tree
     */
    exitPropertyOrLabelExpression?: (ctx: PropertyOrLabelExpressionContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.propertyExpression`.
     * @param ctx the parse tree
     */
    enterPropertyExpression?: (ctx: PropertyExpressionContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.propertyExpression`.
     * @param ctx the parse tree
     */
    exitPropertyExpression?: (ctx: PropertyExpressionContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.patternPart`.
     * @param ctx the parse tree
     */
    enterPatternPart?: (ctx: PatternPartContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.patternPart`.
     * @param ctx the parse tree
     */
    exitPatternPart?: (ctx: PatternPartContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.patternElem`.
     * @param ctx the parse tree
     */
    enterPatternElem?: (ctx: PatternElemContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.patternElem`.
     * @param ctx the parse tree
     */
    exitPatternElem?: (ctx: PatternElemContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.patternElemChain`.
     * @param ctx the parse tree
     */
    enterPatternElemChain?: (ctx: PatternElemChainContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.patternElemChain`.
     * @param ctx the parse tree
     */
    exitPatternElemChain?: (ctx: PatternElemChainContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.properties`.
     * @param ctx the parse tree
     */
    enterProperties?: (ctx: PropertiesContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.properties`.
     * @param ctx the parse tree
     */
    exitProperties?: (ctx: PropertiesContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.nodePattern`.
     * @param ctx the parse tree
     */
    enterNodePattern?: (ctx: NodePatternContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.nodePattern`.
     * @param ctx the parse tree
     */
    exitNodePattern?: (ctx: NodePatternContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.atom`.
     * @param ctx the parse tree
     */
    enterAtom?: (ctx: AtomContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.atom`.
     * @param ctx the parse tree
     */
    exitAtom?: (ctx: AtomContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.lhs`.
     * @param ctx the parse tree
     */
    enterLhs?: (ctx: LhsContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.lhs`.
     * @param ctx the parse tree
     */
    exitLhs?: (ctx: LhsContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.relationshipPattern`.
     * @param ctx the parse tree
     */
    enterRelationshipPattern?: (ctx: RelationshipPatternContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.relationshipPattern`.
     * @param ctx the parse tree
     */
    exitRelationshipPattern?: (ctx: RelationshipPatternContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.relationDetail`.
     * @param ctx the parse tree
     */
    enterRelationDetail?: (ctx: RelationDetailContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.relationDetail`.
     * @param ctx the parse tree
     */
    exitRelationDetail?: (ctx: RelationDetailContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.rangeLit`.
     * @param ctx the parse tree
     */
    enterRangeLit?: (ctx: RangeLitContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.rangeLit`.
     * @param ctx the parse tree
     */
    exitRangeLit?: (ctx: RangeLitContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.relationshipTypes`.
     * @param ctx the parse tree
     */
    enterRelationshipTypes?: (ctx: RelationshipTypesContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.relationshipTypes`.
     * @param ctx the parse tree
     */
    exitRelationshipTypes?: (ctx: RelationshipTypesContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.unionSt`.
     * @param ctx the parse tree
     */
    enterUnionSt?: (ctx: UnionStContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.unionSt`.
     * @param ctx the parse tree
     */
    exitUnionSt?: (ctx: UnionStContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.subqueryExist`.
     * @param ctx the parse tree
     */
    enterSubqueryExist?: (ctx: SubqueryExistContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.subqueryExist`.
     * @param ctx the parse tree
     */
    exitSubqueryExist?: (ctx: SubqueryExistContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.invocationName`.
     * @param ctx the parse tree
     */
    enterInvocationName?: (ctx: InvocationNameContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.invocationName`.
     * @param ctx the parse tree
     */
    exitInvocationName?: (ctx: InvocationNameContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.functionInvocation`.
     * @param ctx the parse tree
     */
    enterFunctionInvocation?: (ctx: FunctionInvocationContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.functionInvocation`.
     * @param ctx the parse tree
     */
    exitFunctionInvocation?: (ctx: FunctionInvocationContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.parenthesizedExpression`.
     * @param ctx the parse tree
     */
    enterParenthesizedExpression?: (ctx: ParenthesizedExpressionContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.parenthesizedExpression`.
     * @param ctx the parse tree
     */
    exitParenthesizedExpression?: (ctx: ParenthesizedExpressionContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.filterWith`.
     * @param ctx the parse tree
     */
    enterFilterWith?: (ctx: FilterWithContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.filterWith`.
     * @param ctx the parse tree
     */
    exitFilterWith?: (ctx: FilterWithContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.patternComprehension`.
     * @param ctx the parse tree
     */
    enterPatternComprehension?: (ctx: PatternComprehensionContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.patternComprehension`.
     * @param ctx the parse tree
     */
    exitPatternComprehension?: (ctx: PatternComprehensionContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.relationshipsChainPattern`.
     * @param ctx the parse tree
     */
    enterRelationshipsChainPattern?: (ctx: RelationshipsChainPatternContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.relationshipsChainPattern`.
     * @param ctx the parse tree
     */
    exitRelationshipsChainPattern?: (ctx: RelationshipsChainPatternContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.listComprehension`.
     * @param ctx the parse tree
     */
    enterListComprehension?: (ctx: ListComprehensionContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.listComprehension`.
     * @param ctx the parse tree
     */
    exitListComprehension?: (ctx: ListComprehensionContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.filterExpression`.
     * @param ctx the parse tree
     */
    enterFilterExpression?: (ctx: FilterExpressionContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.filterExpression`.
     * @param ctx the parse tree
     */
    exitFilterExpression?: (ctx: FilterExpressionContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.countAll`.
     * @param ctx the parse tree
     */
    enterCountAll?: (ctx: CountAllContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.countAll`.
     * @param ctx the parse tree
     */
    exitCountAll?: (ctx: CountAllContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.expressionChain`.
     * @param ctx the parse tree
     */
    enterExpressionChain?: (ctx: ExpressionChainContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.expressionChain`.
     * @param ctx the parse tree
     */
    exitExpressionChain?: (ctx: ExpressionChainContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.caseExpression`.
     * @param ctx the parse tree
     */
    enterCaseExpression?: (ctx: CaseExpressionContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.caseExpression`.
     * @param ctx the parse tree
     */
    exitCaseExpression?: (ctx: CaseExpressionContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.parameter`.
     * @param ctx the parse tree
     */
    enterParameter?: (ctx: ParameterContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.parameter`.
     * @param ctx the parse tree
     */
    exitParameter?: (ctx: ParameterContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.literal`.
     * @param ctx the parse tree
     */
    enterLiteral?: (ctx: LiteralContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.literal`.
     * @param ctx the parse tree
     */
    exitLiteral?: (ctx: LiteralContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.boolLit`.
     * @param ctx the parse tree
     */
    enterBoolLit?: (ctx: BoolLitContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.boolLit`.
     * @param ctx the parse tree
     */
    exitBoolLit?: (ctx: BoolLitContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.numLit`.
     * @param ctx the parse tree
     */
    enterNumLit?: (ctx: NumLitContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.numLit`.
     * @param ctx the parse tree
     */
    exitNumLit?: (ctx: NumLitContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.stringLit`.
     * @param ctx the parse tree
     */
    enterStringLit?: (ctx: StringLitContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.stringLit`.
     * @param ctx the parse tree
     */
    exitStringLit?: (ctx: StringLitContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.charLit`.
     * @param ctx the parse tree
     */
    enterCharLit?: (ctx: CharLitContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.charLit`.
     * @param ctx the parse tree
     */
    exitCharLit?: (ctx: CharLitContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.listLit`.
     * @param ctx the parse tree
     */
    enterListLit?: (ctx: ListLitContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.listLit`.
     * @param ctx the parse tree
     */
    exitListLit?: (ctx: ListLitContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.mapLit`.
     * @param ctx the parse tree
     */
    enterMapLit?: (ctx: MapLitContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.mapLit`.
     * @param ctx the parse tree
     */
    exitMapLit?: (ctx: MapLitContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.mapPair`.
     * @param ctx the parse tree
     */
    enterMapPair?: (ctx: MapPairContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.mapPair`.
     * @param ctx the parse tree
     */
    exitMapPair?: (ctx: MapPairContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.name`.
     * @param ctx the parse tree
     */
    enterName?: (ctx: NameContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.name`.
     * @param ctx the parse tree
     */
    exitName?: (ctx: NameContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.symbol`.
     * @param ctx the parse tree
     */
    enterSymbol?: (ctx: SymbolContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.symbol`.
     * @param ctx the parse tree
     */
    exitSymbol?: (ctx: SymbolContext) => void;
    /**
     * Enter a parse tree produced by `CypherParser.reservedWord`.
     * @param ctx the parse tree
     */
    enterReservedWord?: (ctx: ReservedWordContext) => void;
    /**
     * Exit a parse tree produced by `CypherParser.reservedWord`.
     * @param ctx the parse tree
     */
    exitReservedWord?: (ctx: ReservedWordContext) => void;

    visitTerminal(node: TerminalNode): void {}
    visitErrorNode(node: ErrorNode): void {}
    enterEveryRule(node: ParserRuleContext): void {}
    exitEveryRule(node: ParserRuleContext): void {}
}

