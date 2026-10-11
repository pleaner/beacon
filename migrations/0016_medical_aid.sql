-- Medical aid, so a hospital can be told who pays. Free text: the scheme, the plan or option, and the membership
-- number with the dependant code.
ALTER TABLE users ADD COLUMN medical_aid TEXT;
ALTER TABLE users ADD COLUMN medical_aid_plan TEXT;
ALTER TABLE users ADD COLUMN medical_aid_number TEXT;
