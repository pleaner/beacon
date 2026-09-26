-- Medical details for rescuers, all optional. Free text except blood type.
ALTER TABLE users ADD COLUMN allergies TEXT;
ALTER TABLE users ADD COLUMN conditions TEXT;
ALTER TABLE users ADD COLUMN medication TEXT;
ALTER TABLE users ADD COLUMN blood_type TEXT;        -- one of BLOOD_TYPES
