UPDATE public.site_content
SET
  content = CASE
    WHEN content->>'description' ~* 'approximately[[:space:]]+25([-–]year|[[:space:]]+years?)' THEN
      jsonb_set(
        content,
        '{description}',
        to_jsonb(
          regexp_replace(
            regexp_replace(
              content->>'description',
              '(?i)an approximately 25[-–]year journey of dedicated',
              '25+ years of dedicated'
            ),
            '(?i)approximately[[:space:]]+25[[:space:]]+years?',
            '25+ years'
          )
        ),
        true
      )
    ELSE content
  END,
  subtitle = CASE
    WHEN subtitle = 'Serving Davangere learners for over two decades.'
      THEN 'Serving Davangere learners for 25+ years.'
    ELSE subtitle
  END,
  updated_at = NOW()
WHERE section_key = 'journey'
  AND (
    content->>'description' ~* 'approximately[[:space:]]+25([-–]year|[[:space:]]+years?)'
    OR subtitle = 'Serving Davangere learners for over two decades.'
  );
