-- What an "Other" trip actually is, in the explorer's words ("Kayaking", "Fishing").
ALTER TABLE trips ADD COLUMN activity_text TEXT;

-- Fuller safety checklists. Replaces any admin edits. "Phone battery" stays first:
-- the app ticks it from the phone's battery level.
UPDATE checklists SET items_text = 'Phone battery above 50%
Checked today''s forecast. Mountain weather turns fast
At least 2 litres of water each
Warm layer and rain shell, even if it''s sunny now
Space blanket
Headtorch, with working batteries
Food for longer than you plan to be out
Route downloaded for offline use
First-aid kit and any meds you need
Trip plan filed with SARZA Guardian' WHERE activity = 'hike';

UPDATE checklists SET items_text = 'Phone battery above 50%
Checked today''s forecast
Water or hydration pack
Windproof layer you can carry
Space blanket
Headtorch if you might finish near dark
Route downloaded for offline use
Trip plan filed with SARZA Guardian' WHERE activity = 'run';

UPDATE checklists SET items_text = 'Phone battery above 50%
Rack, rope and harness checked
Helmet
Descent or abseil route known
Partner checks done: knots, belay, rope ends
Headtorch
Water, food and a warm layer
Trip plan filed with SARZA Guardian' WHERE activity = 'climb';

UPDATE checklists SET items_text = 'Phone battery above 50%
Reserve repacked within 6 months
Radio charged and on the club frequency
Wind and forecast checked for launch and landing
Landing and retrieve plan sorted
Water and a warm layer in case you have to walk out
Trip plan filed with SARZA Guardian' WHERE activity = 'paraglide';

UPDATE checklists SET items_text = 'Phone battery above 50%
Helmet
Brakes and tyres checked
Tube, pump and multitool
Water and food
Lights if you might finish near dark
First-aid kit
Trip plan filed with SARZA Guardian' WHERE activity = 'mtb';

UPDATE checklists SET items_text = 'Phone battery above 50%
Checked today''s forecast
Water
Warm layer
Headtorch
Trip plan filed with SARZA Guardian' WHERE activity = 'other';
