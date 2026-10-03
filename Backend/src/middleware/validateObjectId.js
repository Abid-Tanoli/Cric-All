import mongoose from "mongoose";

// An id must be a non-empty string that is actually an ObjectId.
//
// The previous check was `if (id && ...)`, which skipped validation entirely for
// an empty string - so `""` reached the controller, and whether that produced a
// clean 4xx or an unhandled CastError depended on whatever the handler happened
// to do next. That is the wrong place to find out. Rejecting here means every
// route that uses this middleware answers 400 for a malformed id by construction.
//
// `typeof id !== "string"` also covers a repeated query/path parameter, which
// Express hands over as an array, and stops `isValid` from accepting the numeric
// ids it tolerates.
const validateObjectId = (paramName = "id") => {
  return (req, res, next) => {
    const id = req.params[paramName];
    if (typeof id !== "string" || id.trim() === "" || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: `Invalid '${paramName}' parameter`,
      });
    }
    next();
  };
};

export default validateObjectId;