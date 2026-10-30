import { searchToolsContract } from "../search-tools-contract.js";
import { checkOllamaModel } from "./support.js";
searchToolsContract(true, await checkOllamaModel());
