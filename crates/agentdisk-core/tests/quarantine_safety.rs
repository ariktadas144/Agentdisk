//! `restore` and `purge` only ever touch entries inside their plan's
//! quarantine, whatever the journal says. One test function, because it sets
//! process env vars.

use agentdisk_core::cleanup::{self, ItemKind, JournalEntry};
use agentdisk_core::json::Value;
use agentdisk_core::paths::{canon, display, plain};
use std::fs;
use std::path::{Path, PathBuf};

fn tmp() -> PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let d = std::env::temp_dir().join(format!("agentdisk-qsafe-{}-{nanos}", std::process::id()));
    fs::create_dir_all(&d).unwrap();
    plain(&canon(&d))
}

/// A folder with one file in it, standing in for something worth keeping.
fn precious(p: &Path) -> PathBuf {
    fs::create_dir_all(p).unwrap();
    let f = p.join("keep.txt");
    fs::write(&f, b"keep me").unwrap();
    f
}

/// Write a journal by hand, the way a damaged or edited one could look.
fn write_journal(dir: &Path, entries: &[(&Path, &Path)]) {
    let v: Vec<Value> = entries
        .iter()
        .map(|(original, quarantine)| {
            Value::obj(vec![
                ("original", display(original).into()),
                ("quarantine", display(quarantine).into()),
                ("kind", "build-folder".into()),
                ("bytes", 10u64.into()),
                ("moved_at", 0u64.into()),
                ("state", "quarantined".into()),
            ])
        })
        .collect();
    fs::create_dir_all(dir).unwrap();
    fs::write(dir.join("journal.json"), Value::Arr(v).pretty()).unwrap();
}

/// Make a directory link; false when the OS does not allow it here.
fn link_dir(target: &Path, link: &Path) -> bool {
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(target, link).is_ok()
    }
    #[cfg(windows)]
    {
        std::os::windows::fs::symlink_dir(target, link).is_ok()
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = (target, link);
        false
    }
}

fn entry(original: &Path, quarantine: &Path) -> JournalEntry {
    JournalEntry {
        original: original.to_path_buf(),
        quarantine: quarantine.to_path_buf(),
        kind: ItemKind::Build,
        repo: None,
        bytes: 10,
        moved_at: 0,
        state: "quarantined".into(),
    }
}

#[test]
fn restore_and_purge_stay_inside_the_quarantine() {
    let root = tmp();
    let home = root.join("home");
    fs::create_dir_all(&home).unwrap();
    std::env::set_var("HOME", &home);
    std::env::set_var("USERPROFILE", &home);
    std::env::set_var("APPDATA", home.join("AppData/Roaming"));
    std::env::set_var("LOCALAPPDATA", home.join("AppData/Local"));
    std::env::set_var("XDG_DATA_HOME", home.join(".local/share"));
    std::env::set_var("XDG_CONFIG_HOME", home.join(".config"));
    let data = root.join("data");
    std::env::set_var("AGENTDISK_HOME", &data);
    let qdir = data.join("quarantine");

    // ---- purge -----------------------------------------------------------
    let id = "20990101-aaaaaa";
    let plan_dir = qdir.join(id);
    fs::create_dir_all(&plan_dir).unwrap();
    let ok = plan_dir.join("000-node_modules");
    fs::create_dir_all(ok.join("x")).unwrap();
    let proj = root.join("proj");
    let side = proj
        .join(".agentdisk-quarantine")
        .join(format!("{id}-001-cache"));
    fs::create_dir_all(&side).unwrap();
    let outside = root.join("outside");
    let outside_file = precious(&outside);
    let dotdot = plan_dir.join("..").join("..").join("..").join("dotdot");
    let dotdot_file = precious(&root.join("dotdot"));
    let other_side = root
        .join("other")
        .join(".agentdisk-quarantine")
        .join(format!("{id}-002-x"));
    let other_side_file = precious(&other_side);
    let via_link_file = precious(&root.join("linked/victim"));
    let has_link = link_dir(&root.join("linked"), &plan_dir.join("003-link"));
    let mut journal = vec![
        (proj.join("node_modules"), ok.clone()),
        (proj.join("cache"), side.clone()),
        (root.join("o1"), outside.clone()),
        (root.join("o2"), dotdot.clone()),
        (proj.join("x"), other_side.clone()), // side folder, but not next to the original
        (root.join("o3"), plan_dir.clone()),  // the plan folder itself
        (root.join("o4"), plan_dir.join("journal.json")),
    ];
    if has_link {
        // A link inside the plan folder, and an entry reached through it.
        journal.push((root.join("o5"), plan_dir.join("003-link")));
        journal.push((root.join("o6"), plan_dir.join("003-link").join("victim")));
    }
    let refs: Vec<(&Path, &Path)> = journal
        .iter()
        .map(|(o, q)| (o.as_path(), q.as_path()))
        .collect();
    write_journal(&plan_dir, &refs);
    let entries: Vec<(String, JournalEntry)> = cleanup::read_journal(id)
        .into_iter()
        .map(|e| (id.to_string(), e))
        .collect();
    assert_eq!(entries.len(), journal.len());

    let (freed, problems) = cleanup::purge(&entries);
    assert_eq!(
        freed, 20,
        "only the two real entries are deleted: {problems:?}"
    );
    assert_eq!(problems.len(), journal.len() - 2, "{problems:?}");
    assert!(problems
        .iter()
        .all(|p| p.contains("not inside the quarantine")));
    assert!(!ok.exists() && !side.exists());
    assert!(
        outside_file.exists(),
        "outside the quarantine: never deleted"
    );
    assert!(dotdot_file.exists(), "a `..` escape is outside");
    assert!(other_side_file.exists());
    assert!(plan_dir.join("journal.json").exists());
    assert!(via_link_file.exists(), "a link is never followed");
    if has_link {
        assert!(fs::symlink_metadata(plan_dir.join("003-link")).is_ok());
    }
    let states: Vec<String> = cleanup::read_journal(id)
        .into_iter()
        .map(|e| e.state)
        .collect();
    assert_eq!(states.iter().filter(|s| *s == "purged").count(), 2);

    // A bad plan id is refused even when the path exists.
    let stray = data.join("x").join("000-thing");
    let stray_file = precious(&stray);
    let (freed, problems) =
        cleanup::purge(&[("../x".to_string(), entry(&root.join("o7"), &stray))]);
    assert_eq!(freed, 0);
    assert_eq!(problems, vec!["bad plan id".to_string()]);
    assert!(stray_file.exists());

    // ---- restore ---------------------------------------------------------
    let id2 = "20990101-bbbbbb";
    let plan2 = qdir.join(id2);
    let back = plan2.join("000-back");
    fs::create_dir_all(&back).unwrap();
    let away = root.join("away");
    let away_file = precious(&away);
    write_journal(
        &plan2,
        &[
            (&root.join("restored-ok"), &back),
            (&root.join("restored-bad"), &away),
        ],
    );
    let (done, problems) = cleanup::restore(id2);
    assert_eq!(done.len(), 1, "{problems:?}");
    assert!(root.join("restored-ok").is_dir());
    assert_eq!(problems.len(), 1, "{problems:?}");
    assert!(
        problems[0].contains("not inside the quarantine"),
        "{problems:?}"
    );
    assert!(away_file.exists(), "left where it is");
    assert!(!root.join("restored-bad").exists());

    // A plan id that leaves the quarantine folder: nothing moves.
    write_journal(&data.join("x"), &[(&root.join("restored-stray"), &stray)]);
    let (done, problems) = cleanup::restore("../x");
    assert!(done.is_empty());
    assert_eq!(problems, vec!["bad plan id".to_string()]);
    assert!(stray_file.exists() && !root.join("restored-stray").exists());

    let _ = fs::remove_dir_all(&root);
}
