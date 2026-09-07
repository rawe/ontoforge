import { searchContract } from "../search-contract.js";
import { checkOllamaModel } from "./support.js";
searchContract(true, await checkOllamaModel());
