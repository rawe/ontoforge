import { defaultSearchContract } from "../default-search-contract.js";
import { checkOllamaModel } from "./support.js";
defaultSearchContract(true, await checkOllamaModel());
