/*
 [The "BSD licence"]
 Copyright (c) 2022 Boris Zhguchev
 All rights reserved.

 Redistribution and use in source and binary forms with or without
 modification are permitted provided that the following conditions
 are met:
 1. Redistributions of source code must retain the above copyright
    notice this list of conditions and the following disclaimer.
 2. Redistributions in binary form must reproduce the above copyright
    notice this list of conditions and the following disclaimer in the
    documentation and/or other materials provided with the distribution.
 3. The name of the author may not be used to endorse or promote products
    derived from this software without specific prior written permission.

 THIS SOFTWARE IS PROVIDED BY THE AUTHOR ``AS IS'' AND ANY EXPRESS OR
 IMPLIED WARRANTIES INCLUDING BUT NOT LIMITED TO THE IMPLIED WARRANTIES
 OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED.
 IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY DIRECT INDIRECT
 INCIDENTAL SPECIAL EXEMPLARY OR CONSEQUENTIAL DAMAGES (INCLUDING BUT
 NOT LIMITED TO PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE
 DATA OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 THEORY OF LIABILITY WHETHER IN CONTRACT STRICT LIABILITY OR TORT
 (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
 THIS SOFTWARE EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/

// $antlr-format alignTrailingComments true, columnLimit 150, minEmptyLines 1, maxEmptyLinesToKeep 1, reflowComments false, useTab false
// $antlr-format allowShortRulesOnASingleLine false, allowShortBlocksOnASingleLine true, alignSemicolons hanging, alignColons hanging

parser grammar CypherParser;

options {
    tokenVocab = CypherLexer;
}

script
    : SP? query SP? SEMI? SP? EOF
    ;

// statements
query
    : regularQuery
    | standaloneCall
    ;

regularQuery
    : singleQuery unionSt*
    ;

singleQuery
    : singlePartQ
    | multiPartQ
    ;

standaloneCall
    : CALL SP? invocationName SP? parenExpressionChain? (SP? YIELD SP? (MULT | yieldItems))?
    ;

returnSt
    : RETURN SP? projectionBody
    ;

withSt
    : WITH SP? projectionBody (SP? where)?
    ;

skipSt
    : SKIP_W SP? expression
    ;

limitSt
    : LIMIT SP? expression
    ;

projectionBody
    : (SP? DISTINCT)? SP? projectionItems (SP? orderSt)? (SP? skipSt)? (SP? limitSt)?
    ;

projectionItems
    : (MULT | projectionItem) (SP? ',' SP? projectionItem)*
    ;

projectionItem
    : expression (SP? AS SP? symbol)?
    ;

orderItem
    : expression (SP? (ASCENDING | ASC | DESCENDING | DESC))?
    ;

orderSt
    : ORDER SP? BY SP? orderItem (SP? ',' SP? orderItem)*
    ;

singlePartQ
    : (readingStatement SP?)* (returnSt | (updatingStatement SP?)+ (SP? returnSt)?)
    ;

multiPartQ
    : (readingStatement SP?)* (updatingStatement SP?)* withSt SP? singlePartQ
    ;

matchSt
    : (OPTIONAL SP)? MATCH SP? patternWhere
    ;

unwindSt
    : UNWIND SP? expression SP? AS SP? symbol
    ;

readingStatement
    : matchSt
    | unwindSt
    | queryCallSt
    ;

updatingStatement
    : createSt
    | mergeSt
    | deleteSt
    | setSt
    | removeSt
    ;

deleteSt
    : (DETACH SP)? DELETE SP? expressionChain
    ;

removeSt
    : REMOVE SP? removeItem (SP? ',' SP? removeItem)*
    ;

removeItem
    : symbol SP? nodeLabels
    | propertyExpression
    ;

queryCallSt
    : CALL SP? invocationName SP? parenExpressionChain (SP? YIELD SP? yieldItems)?
    ;

parenExpressionChain
    : LPAREN SP? expressionChain? SP? RPAREN
    ;

yieldItems
    : yieldItem (SP? ',' SP? yieldItem)* (SP? where)?
    ;

yieldItem
    : (symbol SP? AS SP?)? symbol
    ;

mergeSt
    : MERGE SP? patternPart (SP? mergeAction)*
    ;

mergeAction
    : ON SP? (MATCH | CREATE) SP? setSt
    ;

setSt
    : SET SP? setItem (SP? ',' SP? setItem)*
    ;

setItem
    : propertyExpression SP? ASSIGN SP? expression
    | symbol SP? (ASSIGN | ADD_ASSIGN) SP? expression
    | symbol SP? nodeLabels
    ;

nodeLabels
    : (COLON SP? name)+
    ;

createSt
    : CREATE SP? pattern
    ;

patternWhere
    : pattern (SP? where)?
    ;

where
    : WHERE SP? expression
    ;

pattern
    : patternPart (SP? ',' SP? patternPart)*
    ;

expression
    : xorExpression (SP? OR SP? xorExpression)*
    ;

xorExpression
    : andExpression (SP? XOR SP? andExpression)*
    ;

andExpression
    : notExpression (SP? AND SP? notExpression)*
    ;

notExpression
    : (NOT SP?)* comparisonExpression
    ;

comparisonExpression
    : addSubExpression (SP? comparisonSigns SP? addSubExpression)*
    ;

comparisonSigns
    : ASSIGN
    | LE
    | GE
    | GT
    | LT
    | NOT_EQUAL
    ;

addSubExpression
    : multDivExpression (SP? (PLUS | SUB) SP? multDivExpression)*
    ;

multDivExpression
    : powerExpression (SP? (MULT | DIV | MOD) SP? powerExpression)*
    ;

powerExpression
    : unaryAddSubExpression (SP? CARET SP? unaryAddSubExpression)*
    ;

unaryAddSubExpression
    : (PLUS | SUB)? SP? atomicExpression
    ;

atomicExpression
    : propertyOrLabelExpression (SP? (stringExpression | listExpression | nullExpression))*
    ;

listExpression
    : SP? IN SP? propertyOrLabelExpression
    | LBRACK SP? (expression? SP? RANGE SP? expression? | expression) SP? RBRACK
    ;

stringExpression
    : stringExpPrefix SP? propertyOrLabelExpression
    ;

stringExpPrefix
    : STARTS SP? WITH
    | ENDS SP? WITH
    | CONTAINS
    ;

nullExpression
    : SP? IS SP? NOT? SP? NULL_W
    ;

propertyOrLabelExpression
    : propertyExpression (SP? nodeLabels)?
    ;

propertyExpression
    : atom (SP? DOT SP? name)*
    ;

patternPart
    : (symbol SP? ASSIGN SP?)? patternElem
    ;

patternElem
    : nodePattern (SP? patternElemChain)*
    | LPAREN SP? patternElem SP? RPAREN
    | functionInvocation
    ;

patternElemChain
    : relationshipPattern SP? nodePattern
    ;

properties
    : mapLit
    | parameter
    ;

nodePattern
    : LPAREN SP? symbol? SP? nodeLabels? SP? properties? SP? RPAREN
    ;

atom
    : literal
    | parameter
    | caseExpression
    | countAll
    | listComprehension
    | patternComprehension
    | filterWith
    | relationshipsChainPattern
    | parenthesizedExpression
    | functionInvocation
    | symbol
    | subqueryExist
    ;

lhs
    : symbol ASSIGN
    ;

relationshipPattern
    : LT SP? SUB SP? relationDetail? SP? SUB SP? GT?
    | SUB SP? relationDetail? SP? SUB SP? GT?
    ;

relationDetail
    : LBRACK SP? symbol? SP? relationshipTypes? SP? rangeLit? SP? properties? SP? RBRACK
    ;

/*
rangeLit
    : MULT SP? numLit? ( RANGE SP? numLit? )?
    ;
*/

rangeLit
    : MULT SP? Integer? ( SP? RANGE SP? Integer? )?
    ;


relationshipTypes
    : COLON SP? name (SP? STICK SP? COLON? SP? name)*
    ;

unionSt
    : UNION SP? ALL? SP? singleQuery
    ;

subqueryExist
    : EXISTS SP? LBRACE SP? (regularQuery | patternWhere) SP? RBRACE
    ;

invocationName
    : symbol (SP? DOT SP? symbol)*
    ;

functionInvocation
    : invocationName SP? LPAREN SP? (DISTINCT SP?)? patternElem SP? RPAREN
    | invocationName SP? LPAREN SP? (DISTINCT SP?)? expressionChain? SP? RPAREN
    ;

parenthesizedExpression
    : LPAREN SP? expression SP? RPAREN
    ;

filterWith
    : (ALL | ANY | NONE | SINGLE) SP? LPAREN SP? filterExpression SP? RPAREN
    ;

patternComprehension
    : LBRACK SP? (lhs SP? ASSIGN SP?)? relationshipsChainPattern (SP? where)? SP? STICK SP? expression SP? RBRACK
    ;

relationshipsChainPattern
    : nodePattern (SP? patternElemChain)+
    ;

listComprehension
    : LBRACK SP? filterExpression (SP? STICK SP? expression)? SP? RBRACK
    ;

filterExpression
    : symbol SP? IN SP? expression (SP? where)?
    ;

countAll
    : COUNT SP? LPAREN SP? MULT SP? RPAREN
    ;

expressionChain
    : expression (SP? ',' SP? expression)*
    ;

caseExpression
    : CASE SP? expression? (SP? WHEN SP? expression SP? THEN SP? expression)+ (SP? ELSE SP? expression)? SP? END
    ;

parameter
    : DOLLAR (symbol | numLit)
    ;

// literals
literal
    : boolLit
    | numLit
    | NULL_W
    | stringLit
    | charLit
    | listLit
    | mapLit
    ;

boolLit
    : TRUE
    | FALSE
    ;

numLit
    : DIGIT
    ;

stringLit
    : STRING_LITERAL
    ;

charLit
    : CHAR_LITERAL
    ;

listLit
    : LBRACK SP? expressionChain? SP? RBRACK
    ;

mapLit
    : LBRACE SP? (mapPair (SP? ',' SP? mapPair)*)? SP? RBRACE
    ;

mapPair
    : name SP? COLON SP? expression
    ;

// primitive ids
name
    : symbol
    | reservedWord
    ;

symbol
    : ESC_LITERAL
    | Integer
    | DIGIT
    | ID
    | COUNT
    | FILTER
    | EXTRACT
    | ANY
    | NONE
    | SINGLE
    ;

reservedWord
    : ALL
    | ASC
    | ASCENDING
    | BY
    | CREATE
    | DELETE
    | DESC
    | DESCENDING
    | DETACH
    | EXISTS
    | LIMIT
    | MATCH
    | MERGE
    | ON
    | OPTIONAL
    | ORDER
    | REMOVE
    | RETURN
    | SET
    | SKIP_W
    | WHERE
    | WITH
    | UNION
    | UNWIND
    | AND
    | AS
    | CONTAINS
    | DISTINCT
    | ENDS
    | IN
    | IS
    | NOT
    | OR
    | STARTS
    | XOR
    | FALSE
    | TRUE
    | NULL_W
    | CONSTRAINT
    | DO
    | FOR
    | REQUIRE
    | UNIQUE
    | CASE
    | WHEN
    | THEN
    | ELSE
    | END
    | MANDATORY
    | SCALAR
    | OF
    | ADD
    | DROP
    ;

