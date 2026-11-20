import { mkdir, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import initSqlJs from 'sql.js';

export async function createResources(dir) {
  const root = dir ?? (await mkdtemp(join(tmpdir(), 'angelus-resources-')));
  await mkdir(join(root, 'script/patches'), { recursive: true });
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  try {
    db.run(
      'CREATE TABLE datas(id INTEGER PRIMARY KEY,ot INTEGER,alias INTEGER,setcode INTEGER,type INTEGER,atk INTEGER,def INTEGER,level INTEGER,race INTEGER,attribute INTEGER,category INTEGER)',
    );
    for (let i = 1; i <= 40; i++)
      db.run('INSERT INTO datas VALUES (?,?,?,?,?,?,?,?,?,?,?)', [
        i,
        3,
        0,
        0,
        17,
        1000,
        800,
        4,
        1,
        1,
        0,
      ]);
    db.run('INSERT INTO datas VALUES (101,3,0,0,67108897,1000,2,1,1,1,0)');
    await writeFile(join(root, 'cards.cdb'), db.export());
  } finally {
    db.close();
  }
  await writeFile(join(root, 'lflist.conf'), '!Example OCG\n1 0\n');
  for (const name of ['constant', 'utility', 'init', 'special'])
    await writeFile(join(root, 'script', name + '.lua'), '-- test fixture\n');
  await writeFile(
    join(root, 'script/utility.lua'),
    'Auxiliary={PreloadUds=function() end}; aux=Auxiliary',
  );
  // An adjust event executes after START, exercising a genuinely late Lua read.
  await writeFile(
    join(root, 'script/patches/entry.lua'),
    [
      'local e=Effect.GlobalEffect()',
      'e:SetType(0x02 + 0x800)',
      'e:SetCode(1040)',
      'e:SetOperation(function(e) e:Reset() Duel.LoadScript("late.lua") if Duel.GetRegistryValue("smoke")=="1" and Duel.SelectYesNo(0,1) then Duel.Win(0,0) end end)',
      'Duel.RegisterEffect(e,0)',
    ].join('\n'),
  );
  await writeFile(
    join(root, 'script/late.lua'),
    'Duel.SetRegistryValue("generation","first")\nDebug.Message("late script ran")',
  );
  return root;
}
