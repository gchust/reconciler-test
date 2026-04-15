SELECT status AS label, COUNT(*)::int AS value
FROM nb_pm_tasks
GROUP BY status
ORDER BY value DESC, label ASC;
