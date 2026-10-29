import { entitySearchContract } from "../entity-search-contract.js";
import { checkOllamaModel } from "./support.js";
entitySearchContract(true, await checkOllamaModel());
