import { searchProfileRunContract } from "../search-profile-run-contract.js";
import { checkOllamaModel } from "./support.js";
searchProfileRunContract(true, await checkOllamaModel());
