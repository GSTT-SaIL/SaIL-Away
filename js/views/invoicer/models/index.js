/* The two ways a quote can be priced, chosen as the first step of the
   pop-up's flow and stored on the quote as details.model. Both use the one
   shared price list (price_list collection): known prices are locked,
   custom lines carry their own price. */
import attendee from "./attendee.js";
import item from "./item.js";

export const MODELS = { attendee, item };
export const modelFor = key => MODELS[key] || null;
