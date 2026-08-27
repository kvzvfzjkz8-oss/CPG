/**
 * Valide le corps, les paramètres ou la requête avec un schéma Zod.
 * Le résultat validé remplace la valeur d'origine : le reste du code
 * ne manipule jamais de données non vérifiées.
 */
export const validate = (schema, source = 'body') => (req, _res, next) => {
  try {
    req[source] = schema.parse(req[source]);
    next();
  } catch (error) {
    next(error);
  }
};
