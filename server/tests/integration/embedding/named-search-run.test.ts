import { namedSearchRunContract } from "../named-search-run-contract.js";
import { checkOllamaModel } from "./support.js";
namedSearchRunContract(true, await checkOllamaModel());
