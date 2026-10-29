import { passageSearchContract } from "../passage-search-contract.js";
import { checkOllamaModel } from "./support.js";
passageSearchContract(true, await checkOllamaModel());
