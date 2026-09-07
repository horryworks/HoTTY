//! Which NetBox field supplies a site's code — the "Site ID" — and how a custom
//! field is discovered.
//!
//! This is a setting rather than a constant because of a measurement: on a real
//! NetBox the site code lived in a **custom field**, while `facility` — NetBox's
//! own field for exactly that — was empty. It cannot be hard-coded.

use super::client::RawSite;
use super::NetboxError;
use serde::Deserialize;

const CUSTOM_PREFIX: &str = "cf:";
const MAX_CUSTOM_KEY_LEN: usize = 64;

/// The configured source of a site's code.
///
/// Stored as **one string** — `slug` | `facility` | `description` | `cf:<key>`,
/// or empty for "no prefix". Deliberately not a kind plus a key: that pair can
/// express "kind = custom, key = none", a state that must not exist. A NetBox
/// field name never contains `:`, so the prefix cannot collide.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SiteIdField {
    Slug,
    Facility,
    Description,
    Custom(String),
}

impl SiteIdField {
    /// The built-in choices. The UI labels these itself, so the set has exactly
    /// one author and the form cannot drift from the parser.
    pub const BUILT_INS: [&'static str; 3] = ["slug", "facility", "description"];

    /// Parse the stored setting. `Ok(None)` means "no prefix configured";
    /// `Err` means the value was not a legal setting at all.
    ///
    /// Parser and validator in one place, called at the command edge, so a bad
    /// value can never reach a sync an hour later.
    pub fn parse(raw: &str) -> Result<Option<Self>, NetboxError> {
        let t = raw.trim();
        if t.is_empty() {
            return Ok(None);
        }
        match t {
            "slug" => return Ok(Some(Self::Slug)),
            "facility" => return Ok(Some(Self::Facility)),
            "description" => return Ok(Some(Self::Description)),
            _ => {}
        }
        let key = t.strip_prefix(CUSTOM_PREFIX).ok_or(NetboxError::SiteIdField)?;
        if key.is_empty() || key.len() > MAX_CUSTOM_KEY_LEN {
            return Err(NetboxError::SiteIdField);
        }
        if !key.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
            return Err(NetboxError::SiteIdField);
        }
        Ok(Some(Self::Custom(key.to_string())))
    }

    /// The string form, which round-trips through [`SiteIdField::parse`].
    pub fn as_stored(&self) -> String {
        match self {
            Self::Slug => "slug".to_string(),
            Self::Facility => "facility".to_string(),
            Self::Description => "description".to_string(),
            Self::Custom(key) => format!("{CUSTOM_PREFIX}{key}"),
        }
    }

    /// This site's code, or `None` when the field is empty on this site.
    ///
    /// 🚨 Only string and number JSON values are accepted from `custom_fields`.
    /// A multiselect is an array and would otherwise be rendered into a folder
    /// name. The picker limits what a user can *choose*; this limits what NetBox
    /// actually *sent*, and only the second is a guarantee.
    pub fn value_of(&self, site: &RawSite) -> Option<String> {
        let raw = match self {
            Self::Slug => site.slug.clone(),
            Self::Facility => site.facility.clone(),
            Self::Description => site.description.clone(),
            Self::Custom(key) => match site.custom_fields.get(key) {
                Some(serde_json::Value::String(s)) => s.clone(),
                Some(serde_json::Value::Number(n)) => n.to_string(),
                // null, bool, array, object — not a code.
                _ => return None,
            },
        };
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    }
}

/// A custom-field **definition** from `/api/extras/custom-fields/`.
#[derive(Debug, Clone, Deserialize)]
pub struct CustomFieldDef {
    pub name: String,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub data_type: String,
    /// NetBox 4.x.
    #[serde(default)]
    pub object_types: Vec<String>,
    /// NetBox 3.x. Both are read because which one is populated depends on the
    /// server's version, and we cannot know it before asking.
    #[serde(default)]
    pub content_types: Vec<String>,
}

impl CustomFieldDef {
    pub fn applies_to_site(&self) -> bool {
        self.object_types
            .iter()
            .chain(self.content_types.iter())
            .any(|t| t.eq_ignore_ascii_case("dcim.site"))
    }

    /// An **allow-list**, so an unfamiliar type shows up as "my field is missing
    /// from the list" — a question someone can ask — rather than as a folder
    /// named after a serialized object.
    pub fn is_scalar(&self) -> bool {
        matches!(self.data_type.as_str(), "string" | "integer" | "decimal")
    }

    /// The value to store if this field is chosen.
    pub fn stored_value(&self) -> String {
        format!("{CUSTOM_PREFIX}{}", self.name)
    }

    /// NetBox's own wording for the field. Not translatable — it is this
    /// deployment's data, not our UI text.
    pub fn display_label(&self) -> String {
        if self.label.trim().is_empty() {
            self.name.clone()
        } else {
            self.label.clone()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    fn site_with(custom: BTreeMap<String, serde_json::Value>) -> RawSite {
        RawSite {
            id: 1,
            name: "Example Site".to_string(),
            region: None,
            slug: "site-01".to_string(),
            facility: "  ".to_string(),
            description: "a site".to_string(),
            custom_fields: custom,
        }
    }

    #[test]
    fn parses_every_built_in() {
        assert_eq!(SiteIdField::parse("slug").unwrap(), Some(SiteIdField::Slug));
        assert_eq!(SiteIdField::parse("facility").unwrap(), Some(SiteIdField::Facility));
        assert_eq!(
            SiteIdField::parse("description").unwrap(),
            Some(SiteIdField::Description)
        );
    }

    #[test]
    fn an_empty_setting_means_no_prefix_not_an_error() {
        assert_eq!(SiteIdField::parse("").unwrap(), None);
        assert_eq!(SiteIdField::parse("   ").unwrap(), None);
    }

    #[test]
    fn parses_a_custom_field() {
        assert_eq!(
            SiteIdField::parse("cf:site_code").unwrap(),
            Some(SiteIdField::Custom("site_code".to_string()))
        );
    }

    #[test]
    fn every_form_round_trips_through_as_stored() {
        for raw in ["slug", "facility", "description", "cf:site_code"] {
            let parsed = SiteIdField::parse(raw).unwrap().unwrap();
            assert_eq!(parsed.as_stored(), raw);
            assert_eq!(SiteIdField::parse(&parsed.as_stored()).unwrap(), Some(parsed));
        }
    }

    #[test]
    fn the_built_in_list_and_the_parser_offer_the_same_set() {
        // If these ever disagree the UI would offer a choice the backend
        // refuses, or hide one it accepts.
        for name in SiteIdField::BUILT_INS {
            assert!(SiteIdField::parse(name).unwrap().is_some(), "{name}");
        }
        assert_eq!(SiteIdField::BUILT_INS.len(), 3);
    }

    #[test]
    fn rejects_malformed_settings() {
        for bad in [
            "cf:",
            "cf:bad-key",
            "cf:has space",
            "slugg",
            "Slug",
            "custom_fields.site_code",
        ] {
            assert!(
                matches!(SiteIdField::parse(bad), Err(NetboxError::SiteIdField)),
                "should reject {bad}"
            );
        }
        let too_long = format!("cf:{}", "a".repeat(MAX_CUSTOM_KEY_LEN + 1));
        assert!(SiteIdField::parse(&too_long).is_err());
    }

    #[test]
    fn reads_a_built_in_value_and_trims_it() {
        let mut site = site_with(BTreeMap::new());
        site.slug = "  site-01  ".to_string();
        assert_eq!(SiteIdField::Slug.value_of(&site), Some("site-01".to_string()));
    }

    #[test]
    fn a_whitespace_only_value_counts_as_absent() {
        let site = site_with(BTreeMap::new());
        // `facility` is "  " in the fixture — NetBox's own site-code field,
        // empty in practice, which is why this is configurable at all.
        assert_eq!(SiteIdField::Facility.value_of(&site), None);
    }

    #[test]
    fn reads_a_string_custom_field() {
        let mut cf = BTreeMap::new();
        cf.insert("site_code".to_string(), serde_json::json!(" SITE-01 "));
        let site = site_with(cf);
        assert_eq!(
            SiteIdField::Custom("site_code".to_string()).value_of(&site),
            Some("SITE-01".to_string())
        );
    }

    #[test]
    fn reads_a_numeric_custom_field() {
        let mut cf = BTreeMap::new();
        cf.insert("site_code".to_string(), serde_json::json!(7));
        let site = site_with(cf);
        assert_eq!(
            SiteIdField::Custom("site_code".to_string()).value_of(&site),
            Some("7".to_string())
        );
    }

    #[test]
    fn refuses_non_scalar_custom_values() {
        // A multiselect would otherwise be rendered into a folder name.
        for value in [
            serde_json::json!(null),
            serde_json::json!(true),
            serde_json::json!(["a", "b"]),
            serde_json::json!({"k": "v"}),
        ] {
            let mut cf = BTreeMap::new();
            cf.insert("site_code".to_string(), value.clone());
            let site = site_with(cf);
            assert_eq!(
                SiteIdField::Custom("site_code".to_string()).value_of(&site),
                None,
                "should refuse {value}"
            );
        }
    }

    #[test]
    fn an_absent_custom_field_is_none() {
        let site = site_with(BTreeMap::new());
        assert_eq!(SiteIdField::Custom("nope".to_string()).value_of(&site), None);
    }

    fn def(data_type: &str, object_types: &[&str], content_types: &[&str]) -> CustomFieldDef {
        CustomFieldDef {
            name: "site_code".to_string(),
            label: "Site Code".to_string(),
            data_type: data_type.to_string(),
            object_types: object_types.iter().map(|s| s.to_string()).collect(),
            content_types: content_types.iter().map(|s| s.to_string()).collect(),
        }
    }

    #[test]
    fn applies_to_site_reads_both_netbox_4x_and_3x_spellings() {
        assert!(def("string", &["dcim.site"], &[]).applies_to_site());
        assert!(def("string", &[], &["dcim.site"]).applies_to_site());
        assert!(!def("string", &["dcim.device"], &["dcim.rack"]).applies_to_site());
    }

    #[test]
    fn only_scalar_types_can_hold_a_site_code() {
        for ok in ["string", "integer", "decimal"] {
            assert!(def(ok, &["dcim.site"], &[]).is_scalar(), "{ok}");
        }
        for bad in ["multiselect", "object", "json", "boolean", "select"] {
            assert!(!def(bad, &["dcim.site"], &[]).is_scalar(), "{bad}");
        }
    }

    #[test]
    fn a_choice_stores_the_cf_prefixed_key_and_shows_netboxs_label() {
        let d = def("string", &["dcim.site"], &[]);
        assert_eq!(d.stored_value(), "cf:site_code");
        assert_eq!(d.display_label(), "Site Code");
        assert!(SiteIdField::parse(&d.stored_value()).unwrap().is_some());
    }

    #[test]
    fn a_field_with_no_label_falls_back_to_its_key() {
        let mut d = def("string", &["dcim.site"], &[]);
        d.label = "  ".to_string();
        assert_eq!(d.display_label(), "site_code");
    }
}
